import { parseVapiMessage, verifyVapiSecret, type VapiEvent } from '../../../../lib/channels/vapi';
import { ChannelError } from '../../../../lib/channels/types';
import type { CallLiveStore } from '../../../../lib/outreach/call-live';
import { contactReplyEvent } from '../../../../lib/workflows/events';
import { ingestOnce, type InboundDeps, type Owner } from './inbound';

export type VapiInboundDeps = Pick<InboundDeps, 'secret' | 'lookupCall' | 'storeCallEvent' | 'sendEvents' | 'ingestLedger' | 'ingestInbound' | 'now' | 'wakeAgent'> & {
  live: CallLiveStore;
};

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/**
 * POST /api/webhooks/vapi. Fails closed: no secret configured -> 503, wrong/missing secret -> 401, both before the
 * body is parsed. Only calls Wayfinder placed (provider call id on a calls row) are accepted. Every write is
 * idempotent: turns by dedupe key, live state by upsert, transcript ingest under the same ledger AgentCall uses.
 */
export async function handleVapiWebhook(req: Request, deps: VapiInboundDeps): Promise<Response> {
  if (!deps.secret) return json(503, { reasons: ['webhook_secret_not_configured'] });
  if (!verifyVapiSecret(req.headers, deps.secret)) return json(401, { reasons: ['invalid_signature'] });
  const raw = await req.text();
  const now = deps.now ?? (() => new Date());
  try {
    const event = parseVapiMessage(raw, now);
    if (event.kind === 'ignored' || !event.callId) return json(200, { ignored: true });
    const owner = await deps.lookupCall(event.callId);
    if (!owner) return json(404, { reasons: ['unknown_call'] });
    return await apply(deps, owner, event, now);
  } catch (err) {
    if (err instanceof ChannelError && err.status === 400) return json(400, { reasons: ['malformed_payload'] });
    // Name and a short single-line message only: never the body, transcript or monitor URLs.
    const name = err instanceof Error ? err.name : typeof err;
    const message = err instanceof Error ? err.message.replace(/wss?:\/\/\S+/gi, '[url]').replace(/\s+/g, ' ').slice(0, 160) : '';
    console.error(`[webhook:vapi] ingest failed: ${name}: ${message}`);
    return json(500, { reasons: ['internal_error'] });
  }
}

async function apply(deps: VapiInboundDeps, owner: Owner, event: Exclude<VapiEvent, { kind: 'ignored' }>, now: () => Date): Promise<Response> {
  const key = { providerCallId: event.callId, contactId: owner.contactId };
  const listen = event.listenUrl ? { listenUrl: event.listenUrl } : {};
  // Browser (web) calls run the same pipeline; only the provider mark differs so the console can label them.
  const provider = event.web ? 'vapi-web' as const : 'vapi' as const;

  if (event.kind === 'status') {
    await deps.live.upsertState(key, { provider, ...(event.status ? { status: event.status } : {}), ...(event.endedReason ? { endedReason: event.endedReason } : {}), ...listen });
    const outcome = event.status === 'ended' ? event.endedReason ?? 'ended' : event.status;
    await deps.storeCallEvent({ contactId: owner.contactId, providerCallId: event.callId, eventType: 'call.status', ...(outcome ? { status: outcome } : {}) });
    return json(200, { ok: true });
  }

  if (event.kind === 'turn') {
    if (event.listenUrl) await deps.live.upsertState(key, { provider, ...listen });
    const added = await deps.live.appendTurns(key, [event.turn]);
    return json(200, added ? { ok: true } : { duplicate: true });
  }

  // end-of-call-report: backfill turns only when none arrived live (live and report turns have different keys).
  if (await deps.live.countTurns(key) === 0) await deps.live.appendTurns(key, event.turns);
  await deps.live.upsertState(key, {
    provider, status: 'ended', ...(event.endedReason ? { endedReason: event.endedReason } : {}),
    ...(event.summary ? { summary: event.summary } : {}), ...listen,
  });
  const at = event.endedAt ? new Date(event.endedAt) : now();
  const receivedAt = Number.isNaN(at.getTime()) ? now() : at;
  await deps.storeCallEvent({
    contactId: owner.contactId, providerCallId: event.callId, eventType: 'call.transcript',
    transcript: event.transcript, endedAt: receivedAt, status: event.endedReason ?? 'ended',
  });
  // Voicemail, no answer, or the callee never spoke: kept on the record, but nobody answered, so no task and no
  // reply event (the contact stays 'sent' and its follow-ups continue), like an automated email reply.
  // The call's own ResourceAgent is woken either way (a voicemail is also news to it); errors never fail the webhook.
  const wake = async () => { try { await deps.wakeAgent?.(owner.contactId, 'webhook:voice'); } catch { /* cron retries */ } };
  if (!event.humanSpoke) { await wake(); return json(200, { ok: true, ingested: false, reason: 'no_human_speech' }); }
  const callId = event.callId;
  const res = await ingestOnce(deps, { kind: 'call', providerCallId: callId, contactId: owner.contactId }, async () => {
    await deps.ingestInbound({ channel: 'voice', contactId: owner.contactId, caseId: owner.caseId, body: event.transcript, providerId: callId, receivedAt: receivedAt.toISOString() });
    await deps.sendEvents(contactReplyEvent({ contactId: owner.contactId, caseId: owner.caseId, dedupeKey: `${callId}-transcript`, callId, receivedAt: receivedAt.toISOString() }));
  });
  if (res.ok) await wake();
  return res;
}
