import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { handleAgentMailWebhook, memoryIngestLedger, type InboundDeps } from '../../../app/api/webhooks/_lib/inbound';
import { recordingSendEvents } from '../../../lib/workflows/events';

const SECRET = `whsec_${Buffer.from('mail-test-secret-bytes').toString('base64')}`;
const OWNER = { contactId: 'contact-A', caseId: 'case-1' };

function headers(body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64')).update(`msg_1.${ts}.${body}`).digest('base64');
  return { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' };
}
const mail = (m: Record<string, unknown>) => JSON.stringify({ type: 'event', event_type: 'message.received', event_id: 'evt_1', message: {
  inbox_id: 'inbox-A', thread_id: 'thread-A', message_id: 'pm-1', from: 'coord@site.test', subject: 'Re: hi', text: 'We can see her.', timestamp: new Date().toISOString(), ...m } });
const post = (body: string) => new Request('https://x.test/hook', { method: 'POST', body, headers: headers(body) });

function deps(over: Partial<InboundDeps> = {}) {
  const woke: string[] = [];
  const stored: string[] = [];
  const replies: unknown[] = [];
  const { send } = recordingSendEvents();
  const d: InboundDeps = {
    secret: SECRET,
    lookupThread: async id => (id === 'thread-A' ? OWNER : undefined),
    lookupCall: async () => undefined,
    storeInboundMessage: async m => { stored.push(m.providerMessageId); return 'stored'; },
    storeCallEvent: async () => undefined,
    sendEvents: send,
    ingestLedger: memoryIngestLedger(),
    ingestInbound: async () => ({}),
    agentForContact: async id => (id === 'contact-A' ? { inboxMode: 'own', inboxId: 'inbox-A' } : null),
    wakeAgent: async (contactId, trigger) => { woke.push(`${contactId}:${trigger}`); },
    patientReplyThread: async id => (id === 'digest-thread' ? 'case-1' : null),
    handlePatientReply: async input => { replies.push(input); },
    ...over,
  };
  return { d, woke, stored, replies };
}

describe('webhook -> resource agent', () => {
  it('a reply wakes the agent for that contact immediately', async () => {
    const { d, woke, stored } = deps();
    const res = await handleAgentMailWebhook(post(mail({})), d);
    expect(res.status).toBe(200);
    expect(stored).toEqual(['pm-1']);
    expect(woke).toEqual(['contact-A:webhook:email']);
  });

  it("a message on agent A's thread that arrived in another agent's inbox is refused and wakes nobody", async () => {
    const { d, woke, stored } = deps();
    const res = await handleAgentMailWebhook(post(mail({ inbox_id: 'inbox-B' })), d);
    expect(res.status).toBe(409);
    expect(stored).toEqual([]);
    expect(woke).toEqual([]);
  });

  it('a patient reply to a digest goes to the patient-reply path, never to a contact', async () => {
    const { d, woke, stored, replies } = deps();
    const res = await handleAgentMailWebhook(post(mail({ thread_id: 'digest-thread', from: 'patient@test.example', text: 'email only' })), d);
    expect(res.status).toBe(200);
    expect(replies).toEqual([{ threadId: 'digest-thread', from: 'patient@test.example', body: 'email only' }]);
    expect(stored).toEqual([]);
    expect(woke).toEqual([]);
  });
});
