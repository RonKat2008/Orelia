import { parseAgentCallWebhook } from '../../../../lib/channels/agentcall';
import { parseAgentMailWebhook } from '../../../../lib/channels/agentmail';
import { ChannelError } from '../../../../lib/channels/types';
import type { WebhookInboundEvent } from './ingest';
import { contactReplyEvent, type SendEvents } from '../../../../lib/workflows/events';

export const BODY_TOO_LARGE_TEXT = '[Reply body too large to receive automatically. Open it in AgentMail.]';

export interface Owner { contactId: string; caseId: string }

/** What one ingest attempt is about: an inbound email (by provider message id) or a call transcript. */
export type IngestKey =
  | { kind: 'email'; providerMessageId: string }
  | { kind: 'call'; providerCallId: string; contactId: string };

/**
 * Records whether a stored inbound message / transcript has been fully ingested (classified -> tasks, contact
 * state). The message row is stored before ingest, so a provider retry after a failed ingest must re-run ingest
 * rather than stop at the provider-id duplicate check.
 * - claim: 'claimed' (this request runs ingest), 'done' (already ingested), 'busy' (another request holds a
 *   live lease; the provider should retry later).
 * - complete: marks the key ingested. release: drops the lease after a failure so a retry can claim it.
 */
export interface IngestLedger {
  claim(key: IngestKey): Promise<'claimed' | 'done' | 'busy'>;
  complete(key: IngestKey): Promise<void>;
  release(key: IngestKey): Promise<void>;
}

/** In-process ledger for tests and the offline journey. */
export function memoryIngestLedger(): IngestLedger {
  const state = new Map<string, 'claimed' | 'done'>();
  const id = (k: IngestKey) => (k.kind === 'email' ? `email:${k.providerMessageId}` : `call:${k.contactId}:${k.providerCallId}`);
  return {
    async claim(k) {
      const cur = state.get(id(k));
      if (cur === 'done') return 'done';
      if (cur === 'claimed') return 'busy';
      state.set(id(k), 'claimed');
      return 'claimed';
    },
    async complete(k) { state.set(id(k), 'done'); },
    async release(k) { if (state.get(id(k)) === 'claimed') state.delete(id(k)); },
  };
}

/**
 * Result of storing an inbound message. The object form carries the stored messages.id (also for a duplicate, the
 * existing row's id); the bare status string is accepted for stores that have no row id (no messageId is then sent on).
 */
export type StoreInboundResult = 'stored' | 'duplicate' | { status: 'stored' | 'duplicate'; id: string };

export interface InboundDeps {
  secret: string | undefined;
  lookupThread(providerThreadId: string): Promise<Owner | undefined>;
  lookupCall(providerCallId: string): Promise<Owner | undefined>;
  storeInboundMessage(m: {
    contactId: string; providerThreadId: string; providerMessageId: string; from?: string; subject?: string;
    body: string; receivedAt: Date; classification?: string;
  }): Promise<StoreInboundResult>;
  storeCallEvent(e: { contactId: string; providerCallId: string; eventType: string; status?: string; transcript?: string; endedAt?: Date }): Promise<void>;
  sendEvents: SendEvents;
  ingestLedger: IngestLedger;
  /** Called only after signature checks and once this request holds the ingest claim. Must be idempotent. */
  ingestInbound(event: WebhookInboundEvent): Promise<unknown>;
  /** Optional: AI verification calls (lib/verification), which have no contact row. */
  verification?: VerificationInboundDeps;
  now?: () => Date;
}

export interface VerificationInboundDeps {
  isVerificationCall(providerCallId: string): Promise<boolean>;
  /** The transcript is untrusted data; it is parsed, never followed. */
  ingest(providerCallId: string, transcript: unknown, receivedAt: string): Promise<unknown>;
  status(providerCallId: string, status: string | undefined): Promise<unknown>;
  /**
   * True while a just-approved verification call has no saved provider call id yet. An unknown call id then gets a
   * retryable 503 (the provider redelivers) instead of a 404 that would drop the transcript.
   */
  hasPendingCall?(): Promise<boolean>;
}

/** Raw AgentCall turns from an already signature-verified body. */
function rawTranscript(rawBody: string): unknown {
  try {
    const data = (JSON.parse(rawBody) as { data?: { transcript?: unknown } }).data;
    return Array.isArray(data?.transcript) ? data.transcript : [];
  } catch { return []; }
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

function errorResponse(err: unknown, provider: 'agentmail' | 'agentcall'): Response {
  if (err instanceof ChannelError) {
    if (err.status === 401) return json(401, { reasons: ['invalid_signature'] });
    if (err.status === 400) return json(400, { reasons: ['malformed_payload'] });
    if (err.status === 404) return json(404, { reasons: ['unknown_thread'] });
    if (err.status === 422) return json(200, { ignored: true });
  }
  // Name and a short, single-line message only (never the inbound body), so a 500 is diagnosable in the logs.
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 160) : '';
  console.error(`[webhook:${provider}] ingest failed: ${name}: ${message}`);
  return json(500, { reasons: ['internal_error'] });
}

const inProgress = () => json(503, { reasons: ['ingest_in_progress'], retryable: true });

/**
 * Runs ingest + the reply event under the ledger claim. Only a fully successful run is marked complete; on any
 * failure the lease is released and the error propagates (500), so the provider's retry re-runs both steps.
 */
export async function ingestOnce(deps: Pick<InboundDeps, 'ingestLedger'>, key: IngestKey, run: () => Promise<void>): Promise<Response> {
  const claim = await deps.ingestLedger.claim(key);
  if (claim === 'done') return json(200, { duplicate: true });
  if (claim === 'busy') return inProgress();
  try {
    await run();
  } catch (err) {
    await deps.ingestLedger.release(key).catch(() => undefined);
    throw err;
  }
  await deps.ingestLedger.complete(key);
  return json(200, { ok: true });
}

/** True when AgentMail omitted the body (messages over 64 KiB come with body_url instead of text). */
function bodyOmitted(rawBody: string): boolean {
  try {
    const m = (JSON.parse(rawBody) as { message?: Record<string, unknown> }).message;
    if (!m || typeof m !== 'object') return false;
    return typeof m.body_url === 'string' && m.body_url !== '' && typeof m.text !== 'string' && typeof m.extracted_text !== 'string';
  } catch { return false; }
}

export async function handleAgentMailWebhook(req: Request, deps: InboundDeps): Promise<Response> {
  if (!deps.secret) return json(503, { reasons: ['webhook_secret_not_configured'] });
  const raw = await req.text();
  const now = deps.now ?? (() => new Date());
  let owner: Owner | undefined;
  try {
    const parsed = await parseAgentMailWebhook(raw, req.headers, deps.secret, async id => {
      owner = await deps.lookupThread(id);
      return owner?.contactId;
    }, now);
    if (!owner || !parsed.threadId || !parsed.messageId) return json(404, { reasons: ['unknown_thread'] });
    const tooLarge = bodyOmitted(raw);
    const receivedAt = new Date(parsed.receivedAt);
    // 'duplicate' only means the row exists; whether it was ingested is the ledger's call.
    const stored = await deps.storeInboundMessage({
      contactId: owner.contactId, providerThreadId: parsed.threadId, providerMessageId: parsed.messageId,
      ...(parsed.from !== undefined ? { from: parsed.from } : {}),
      ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
      body: tooLarge ? BODY_TOO_LARGE_TEXT : parsed.body, receivedAt,
      ...(tooLarge ? { classification: 'body_too_large' } : parsed.automated ? { classification: 'automated' } : {}),
    });
    // Bounces, out-of-office and other auto-replies are kept on the record but are not the contact answering:
    // no ingest (no task) and no contact/reply event, so the contact stays 'sent' and follow-ups continue.
    if (parsed.automated) return json(200, { ignored: true, automated: true });
    const storedMessageId = typeof stored === 'object' ? stored.id : undefined;
    const o = owner;
    const { threadId, messageId } = parsed;
    return await ingestOnce(deps, { kind: 'email', providerMessageId: messageId }, async () => {
      await deps.ingestInbound({
        channel: 'email', contactId: o.contactId, caseId: o.caseId,
        body: tooLarge ? BODY_TOO_LARGE_TEXT : parsed.body, providerId: messageId, providerThreadId: threadId,
        receivedAt: receivedAt.toISOString(),
        ...(storedMessageId !== undefined ? { messageId: storedMessageId } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
        ...(parsed.from !== undefined ? { from: parsed.from } : {}),
      });
      await deps.sendEvents(contactReplyEvent({
        contactId: o.contactId, caseId: o.caseId, dedupeKey: messageId, messageId, receivedAt: receivedAt.toISOString(),
      }));
    });
  } catch (err) { return errorResponse(err, 'agentmail'); }
}

export async function handleAgentCallWebhook(req: Request, deps: InboundDeps): Promise<Response> {
  if (!deps.secret) return json(503, { reasons: ['webhook_secret_not_configured'] });
  const raw = await req.text();
  let owner: Owner | undefined;
  let verification = false;
  let pending = false;
  try {
    // Runs only after the signature check passed.
    const parsed = await parseAgentCallWebhook(raw, req.headers, deps.secret, async id => {
      owner = await deps.lookupCall(id);
      if (!owner && deps.verification && await deps.verification.isVerificationCall(id)) { verification = true; return 'verification'; }
      if (!owner && deps.verification?.hasPendingCall && await deps.verification.hasPendingCall()) { pending = true; return 'pending'; }
      return owner?.contactId;
    });
    if (verification && deps.verification && parsed.callId) {
      const at = new Date(parsed.receivedAt);
      const receivedAt = (Number.isNaN(at.getTime()) ? (deps.now ?? (() => new Date()))() : at).toISOString();
      if (parsed.eventType === 'call.transcript') await deps.verification.ingest(parsed.callId, rawTranscript(raw), receivedAt);
      else if (parsed.eventType === 'call.status') await deps.verification.status(parsed.callId, parsed.status);
      else return json(200, { ignored: true });
      return json(200, { ok: true });
    }
    if (pending) return json(503, { reasons: ['call_pending'], retryable: true });
    if (!owner || !parsed.callId) return json(404, { reasons: ['unknown_call'] });
    const at = new Date(parsed.receivedAt);
    const receivedAt = Number.isNaN(at.getTime()) ? (deps.now ?? (() => new Date()))() : at;
    if (parsed.eventType === 'call.transcript') {
      await deps.storeCallEvent({
        contactId: owner.contactId, providerCallId: parsed.callId, eventType: parsed.eventType,
        transcript: parsed.body, endedAt: receivedAt, ...(parsed.status ? { status: parsed.status } : {}),
      });
      const o = owner;
      const callId = parsed.callId;
      return await ingestOnce(deps, { kind: 'call', providerCallId: callId, contactId: o.contactId }, async () => {
        await deps.ingestInbound({
          channel: 'voice', contactId: o.contactId, caseId: o.caseId,
          body: parsed.body, providerId: callId, receivedAt: receivedAt.toISOString(),
        });
        await deps.sendEvents(contactReplyEvent({
          contactId: o.contactId, caseId: o.caseId, dedupeKey: `${callId}-transcript`, callId, receivedAt: receivedAt.toISOString(),
        }));
      });
    }
    if (parsed.eventType === 'call.status') {
      await deps.storeCallEvent({
        contactId: owner.contactId, providerCallId: parsed.callId, eventType: parsed.eventType,
        ...(parsed.status ? { status: parsed.status } : {}),
      });
      return json(200, { ok: true });
    }
    return json(200, { ignored: true });
  } catch (err) { return errorResponse(err, 'agentcall'); }
}

/**
 * DEMO ONLY: a simulated call (demo destinations, no allowlisted test number) has no provider and no webhook, so its
 * scripted transcript enters here, through the same steps as a verified AgentCall transcript: stored on the calls
 * row, ingested once under the ledger (classifier -> tasks, case document), then the contact reply event.
 */
export async function ingestSimulatedCallTranscript(
  deps: Pick<InboundDeps, 'storeCallEvent' | 'ingestLedger' | 'ingestInbound' | 'sendEvents'>,
  input: { contactId: string; caseId: string; callId: string; transcript: string; status: string; receivedAt: string },
): Promise<void> {
  await deps.storeCallEvent({
    contactId: input.contactId, providerCallId: input.callId, eventType: 'call.transcript',
    transcript: input.transcript, endedAt: new Date(input.receivedAt), status: input.status,
  });
  const key: IngestKey = { kind: 'call', providerCallId: input.callId, contactId: input.contactId };
  const claim = await deps.ingestLedger.claim(key);
  if (claim !== 'claimed') return;
  try {
    await deps.ingestInbound({ channel: 'voice', contactId: input.contactId, caseId: input.caseId, body: input.transcript, providerId: input.callId, receivedAt: input.receivedAt });
    await deps.sendEvents(contactReplyEvent({ contactId: input.contactId, caseId: input.caseId, dedupeKey: `${input.callId}-transcript`, callId: input.callId, receivedAt: input.receivedAt }));
  } catch (err) {
    await deps.ingestLedger.release(key).catch(() => undefined);
    throw err;
  }
  await deps.ingestLedger.complete(key);
}
