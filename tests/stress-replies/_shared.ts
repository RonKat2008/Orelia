import type { DraftContext } from '../../lib/inbox/drafts';
import type { InboxClassification } from '../../lib/inbox/schema';
import type { InboxClassifier } from '../../lib/inbox/classifier';

export const OWNER = { contactId: '11111111-1111-4111-8111-111111111111', caseId: '22222222-2222-4222-8222-222222222222' };
/** Shape of what loadDraftContext (app/api/webhooks/_lib/postgres.ts) returns in production. */
export const prodCtx: DraftContext = {
  contactId: OWNER.contactId, caseId: OWNER.caseId, resourceName: 'Example Sarcoma Center',
  consent: { sharedFields: ['diseaseName'] }, caseRecord: { diseaseName: 'epithelioid sarcoma' } as never,
};
export const stubClassifier = (c: InboxClassification): InboxClassifier => ({ classify: async () => c });

import { createHmac } from 'node:crypto';
import { handleAgentMailWebhook, memoryIngestLedger, type InboundDeps } from '../../app/api/webhooks/_lib/inbound';
import { recordingSendEvents } from '../../lib/workflows/events';

export const MAIL_SECRET = `whsec_${Buffer.from('stress-mail-secret').toString('base64')}`;
export function signedPost(body: string, svixId = 'msg_1') {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from(MAIL_SECRET.slice(6), 'base64')).update(`${svixId}.${ts}.${body}`).digest('base64');
  return new Request('https://x.test/hook', { method: 'POST', body, headers: { 'svix-id': svixId, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}`, 'content-type': 'application/json' } });
}
export function mailBody(message: Record<string, unknown>) {
  return JSON.stringify({ type: 'event', event_type: 'message.received', event_id: 'evt_1', message: {
    inbox_id: 'inbox-1', thread_id: 'thread-1', message_id: 'pm-1', from: 'coord@site.test', subject: 'Re: hi',
    timestamp: new Date().toISOString(), ...message } });
}
export function mailDeps(ingestInbound: InboundDeps['ingestInbound']) {
  const { send, events } = recordingSendEvents();
  const stored: Parameters<InboundDeps['storeInboundMessage']>[0][] = [];
  const deps: InboundDeps = {
    secret: MAIL_SECRET,
    lookupThread: async id => (id === 'thread-1' ? OWNER : undefined),
    lookupCall: async () => undefined,
    storeInboundMessage: async m => { stored.push(m); return stored.length > 1 ? 'duplicate' : 'stored'; },
    storeCallEvent: async () => undefined,
    sendEvents: send, ingestLedger: memoryIngestLedger(), ingestInbound,
  };
  return { deps, events, stored, handle: (body: string) => handleAgentMailWebhook(signedPost(body), deps) };
}
