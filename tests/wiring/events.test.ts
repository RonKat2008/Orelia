import { describe, expect, it } from 'vitest';
import {
  CONTACT_APPROVED,
  CONTACT_REPLY,
  FOLLOW_UP_APPROVED,
  contactApprovedEvent,
  contactReplyEvent,
  followUpApprovedEvent,
  noopSendEvents,
  recordingSendEvents,
} from '../../lib/workflows';

describe('workflow events', () => {
  it('contact approved dedupes per message', () => {
    const e = contactApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm1', approvedAt: '2026-03-02T00:00:00Z' });
    expect(e.name).toBe(CONTACT_APPROVED);
    expect(e.id).toBe('contact-approved-m1');
    expect(e.data).toEqual({ contactId: 'c', caseId: 'k', messageId: 'm1', approvedAt: '2026-03-02T00:00:00Z' });
  });
  it('reply dedupes per dedupeKey', () => {
    const e = contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'am-123', callId: 'call1', receivedAt: 'x' });
    expect(e.name).toBe(CONTACT_REPLY);
    expect(e.id).toBe('contact-reply-am-123');
    expect(e.data.callId).toBe('call1');
  });
  it('follow-up approved dedupes per message', () => {
    const e = followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm2', approvedAt: 'x' });
    expect(e.name).toBe(FOLLOW_UP_APPROVED);
    expect(e.id).toBe('follow-up-approved-m2');
  });
  it('recording sender collects single and batched events; noop does nothing', async () => {
    const r = recordingSendEvents();
    const a = followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm2', approvedAt: 'x' });
    await r.send(a);
    await r.send([a, a]);
    expect(r.events).toHaveLength(3);
    await expect(noopSendEvents(a)).resolves.toBeUndefined();
  });
});
