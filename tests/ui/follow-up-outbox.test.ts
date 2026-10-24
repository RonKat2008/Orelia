import { describe, expect, it } from 'vitest';
import { contactsFromActivity } from '../../components/outreach/case-activity';
import { followUpLabel } from '../../components/outreach/format';
import { REFUSAL_LABELS } from '../../components/outreach/client';

describe('follow-up drafts in the outbox and tracker', () => {
  it('labels follow-up drafts and leaves first messages alone', () => {
    expect(followUpLabel('follow_up_1')).toBe('Follow-up 1 of 2');
    expect(followUpLabel('follow_up_2')).toBe('Follow-up 2 of 2');
    expect(followUpLabel(null)).toBeNull();
    expect(followUpLabel(undefined)).toBeNull();
    expect(followUpLabel('reply')).toBeNull();
  });

  it('carries followUpAwaitingApproval from the contacts API, defaulting to false', () => {
    const base = { id: 'c1', caseId: 'k', targetId: 't', targetKind: 'institution', channel: 'email', address: 'a@example.com', state: 'sent' };
    const [a, b] = contactsFromActivity({ contacts: [{ ...base, followUpAwaitingApproval: true }, { ...base, id: 'c2' }] })!;
    expect(a.followUpAwaitingApproval).toBe(true);
    expect(b.followUpAwaitingApproval).toBe(false);
  });

  it('explains the follow-up refusals in plain words', () => {
    for (const key of ['follow_up_not_sendable', 'follow_up_not_sent', 'follow_up_out_of_order']) expect(REFUSAL_LABELS[key]).toBeTruthy();
  });
});
