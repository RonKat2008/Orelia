import { parseAgentCallWebhook } from '../../../../lib/channels/agentcall';
import { parseAgentMailWebhook } from '../../../../lib/channels/agentmail';
import { ChannelError } from '../../../../lib/channels/types';
import { contactReplyEvent, type SendEvents } from '../../../../lib/workflows/events';

export const BODY_TOO_LARGE_TEXT = '[Reply body too large to receive automatically. Open it in AgentMail.]';

export interface Owner { contactId: string; caseId: string }

export interface InboundDeps {
  secret: string | undefined;
  lookupThread(providerThreadId: string): Promise<Owner | undefined>;
  lookupCall(providerCallId: string): Promise<Owner | undefined>;
  storeInboundMessage(m: {
    contactId: string; providerThreadId: string; providerMessageId: string; from?: string; subject?: string;
    body: string; receivedAt: Date; classification?: string;
  }): Promise<'stored' | 'duplicate'>;
  storeCallEvent(e: { contactId: string; providerCallId: string; eventType: string; status?: string; transcript?: string; endedAt?: Date }): Promise<void>;
  sendEvents: SendEvents;
  /** Called only after signature checks and provider-id dedupe. */
  ingestInbound(event: {
    channel: 'email' | 'voice';
    contactId: string;
    caseId: string;
    body: string;
    providerId: string;
    subject?: string;
    from?: string;
  }): Promise<unknown>;
  now?: () => Date;
}

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

function errorResponse(err: unknown): Response {
  if (err instanceof ChannelError) {
    if (err.status === 401) return json(401, { reasons: ['invalid_signature'] });
    if (err.status === 400) return json(400, { reasons: ['malformed_payload'] });
    if (err.status === 404) return json(404, { reasons: ['unknown_thread'] });
    if (err.status === 422) return json(200, { ignored: true });
  }
  return json(500, { reasons: ['internal_error'] });
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
    const result = await deps.storeInboundMessage({
      contactId: owner.contactId, providerThreadId: parsed.threadId, providerMessageId: parsed.messageId,
      ...(parsed.from !== undefined ? { from: parsed.from } : {}),
      ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
      body: tooLarge ? BODY_TOO_LARGE_TEXT : parsed.body, receivedAt,
      ...(tooLarge ? { classification: 'body_too_large' } : {}),
    });
    if (result === 'duplicate') return json(200, { duplicate: true });
    await deps.ingestInbound({
      channel: 'email', contactId: owner.contactId, caseId: owner.caseId,
      body: tooLarge ? BODY_TOO_LARGE_TEXT : parsed.body, providerId: parsed.messageId,
      ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
      ...(parsed.from !== undefined ? { from: parsed.from } : {}),
    });
    await deps.sendEvents(contactReplyEvent({
      contactId: owner.contactId, caseId: owner.caseId, dedupeKey: parsed.messageId, messageId: parsed.messageId, receivedAt: receivedAt.toISOString(),
    }));
    return json(200, { ok: true });
  } catch (err) { return errorResponse(err); }
}

export async function handleAgentCallWebhook(req: Request, deps: InboundDeps): Promise<Response> {
  if (!deps.secret) return json(503, { reasons: ['webhook_secret_not_configured'] });
  const raw = await req.text();
  let owner: Owner | undefined;
  try {
    const parsed = await parseAgentCallWebhook(raw, req.headers, deps.secret, async id => {
      owner = await deps.lookupCall(id);
      return owner?.contactId;
    });
    if (!owner || !parsed.callId) return json(404, { reasons: ['unknown_call'] });
    const at = new Date(parsed.receivedAt);
    const receivedAt = Number.isNaN(at.getTime()) ? (deps.now ?? (() => new Date()))() : at;
    if (parsed.eventType === 'call.transcript') {
      await deps.storeCallEvent({
        contactId: owner.contactId, providerCallId: parsed.callId, eventType: parsed.eventType,
        transcript: parsed.body, endedAt: receivedAt, ...(parsed.status ? { status: parsed.status } : {}),
      });
      await deps.ingestInbound({
        channel: 'voice', contactId: owner.contactId, caseId: owner.caseId,
        body: parsed.body, providerId: parsed.callId,
      });
      await deps.sendEvents(contactReplyEvent({
        contactId: owner.contactId, caseId: owner.caseId, dedupeKey: `${parsed.callId}-transcript`, callId: parsed.callId, receivedAt: receivedAt.toISOString(),
      }));
      return json(200, { ok: true });
    }
    if (parsed.eventType === 'call.status') {
      await deps.storeCallEvent({
        contactId: owner.contactId, providerCallId: parsed.callId, eventType: parsed.eventType,
        ...(parsed.status ? { status: parsed.status } : {}),
      });
      return json(200, { ok: true });
    }
    return json(200, { ignored: true });
  } catch (err) { return errorResponse(err); }
}
