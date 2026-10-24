import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { handleAgentCallWebhook, type InboundDeps } from '@/app/api/webhooks/_lib/inbound';
import { recordingSendEvents } from '@/lib/workflows/events';

const SECRET = 'call-test-secret';
const sign = (body: string, secret = SECRET) => ({ 'x-agentcall-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` });
const post = (body: string, headers: Record<string, string>) => new Request('https://x.test/hook', { method: 'POST', body, headers });
const body = (event: string, data: Record<string, unknown>) => JSON.stringify({ event, timestamp: '2026-10-24T16:00:00.000Z', data });

function setup() {
  const { send } = recordingSendEvents();
  const verification = {
    isVerificationCall: vi.fn(async (id: string) => id === 'ver-call-1'),
    ingest: vi.fn(async () => ({})),
    status: vi.fn(async () => ({})),
  };
  const ingestInbound = vi.fn(async () => ({}));
  const storeCallEvent = vi.fn(async () => {});
  const deps: InboundDeps = {
    secret: SECRET,
    lookupThread: async () => undefined,
    lookupCall: async id => (id === 'call-1' ? { contactId: 'contact-1', caseId: 'case-1' } : undefined),
    storeInboundMessage: async () => 'stored',
    storeCallEvent,
    sendEvents: send,
    ingestInbound,
    verification,
  };
  return { deps, verification, ingestInbound, storeCallEvent };
}

describe('AgentCall webhook: verification calls', () => {
  const turns = [{ role: 'ai', text: 'Are you accepting new adult patients?' }, { role: 'human', text: 'Yes we are.' }];

  it('routes a verification call transcript (raw turns) to the verification ingest, not the inbox', async () => {
    const { deps, verification, ingestInbound, storeCallEvent } = setup();
    const b = body('call.transcript', { callId: 'ver-call-1', transcript: turns });
    const res = await handleAgentCallWebhook(post(b, sign(b)), deps);
    expect(res.status).toBe(200);
    expect(verification.ingest).toHaveBeenCalledWith('ver-call-1', turns, '2026-10-24T16:00:00.000Z');
    expect(ingestInbound).not.toHaveBeenCalled();
    expect(storeCallEvent).not.toHaveBeenCalled();
  });

  it('call.status goes to the verification status handler; a bad signature is still 401', async () => {
    const { deps, verification } = setup();
    const b = body('call.status', { callId: 'ver-call-1', status: 'no-answer' });
    expect((await handleAgentCallWebhook(post(b, sign(b)), deps)).status).toBe(200);
    expect(verification.status).toHaveBeenCalledWith('ver-call-1', 'no-answer');
    expect((await handleAgentCallWebhook(post(b, sign(b, 'wrong')), deps)).status).toBe(401);
    expect(verification.ingest).not.toHaveBeenCalled();
  });

  it('normal outreach calls keep the existing path; unknown calls are 404', async () => {
    const { deps, verification, ingestInbound } = setup();
    const b = body('call.transcript', { callId: 'call-1', transcript: turns });
    expect((await handleAgentCallWebhook(post(b, sign(b)), deps)).status).toBe(200);
    expect(ingestInbound).toHaveBeenCalledTimes(1);
    expect(verification.ingest).not.toHaveBeenCalled();
    const u = body('call.transcript', { callId: 'nope', transcript: turns });
    expect((await handleAgentCallWebhook(post(u, sign(u)), deps)).status).toBe(404);
  });
});

describe('safety review: early transcript before the call id is saved', () => {
  const turns = [{ role: 'ai', text: 'Are you accepting new adult patients?' }, { role: 'human', text: 'Yes we are.' }];
  it('an unknown call id while a verification call is pending -> retryable 503; otherwise 404', async () => {
    const { deps, verification } = setup();
    const u = body('call.transcript', { callId: 'early-call', transcript: turns });
    const pending = { ...deps, verification: { ...verification, hasPendingCall: vi.fn(async () => true) } };
    const res = await handleAgentCallWebhook(post(u, sign(u)), pending);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ reasons: ['call_pending'], retryable: true });
    expect(verification.ingest).not.toHaveBeenCalled();
    const idle = { ...deps, verification: { ...verification, hasPendingCall: vi.fn(async () => false) } };
    expect((await handleAgentCallWebhook(post(u, sign(u)), idle)).status).toBe(404);
  });
});
