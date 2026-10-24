import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_BODY,
  deriveContext,
  followUpContent,
  type ContactRowLike,
} from '../../lib/workflows/contact-store';
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';

const d = (s: string) => new Date(s);
const row = (p: Partial<ContactRowLike> = {}): ContactRowLike => ({
  state: 'drafted',
  firstSentAt: null,
  followUpsSent: 0,
  nextFollowUpAt: null,
  lastActivityAt: null,
  ...p,
});

describe('deriveContext', () => {
  it('drafted contact has no send history', () => {
    const c = deriveContext(row(), [{ sentAt: null, classification: null }]);
    expect(c).toMatchObject({ state: 'drafted', firstSentAt: null, lastOutboundAt: null, followUpsDue: 0, followUpsSent: 0 });
  });

  it('sent with first_sent_at uses the column', () => {
    const c = deriveContext(row({ state: 'sent', firstSentAt: d('2026-03-02T10:00:00Z') }), [
      { sentAt: d('2026-03-02T10:00:05Z'), classification: null },
    ]);
    expect(c.firstSentAt).toEqual(d('2026-03-02T10:00:00Z'));
    expect(c.lastOutboundAt).toEqual(d('2026-03-02T10:00:05Z'));
  });

  it('sent without first_sent_at falls back to min(sent_at)', () => {
    const c = deriveContext(row({ state: 'sent' }), [
      { sentAt: d('2026-03-05T10:00:00Z'), classification: 'follow_up_1' },
      { sentAt: d('2026-03-02T10:00:00Z'), classification: null },
    ]);
    expect(c.firstSentAt).toEqual(d('2026-03-02T10:00:00Z'));
    expect(c.lastOutboundAt).toEqual(d('2026-03-05T10:00:00Z'));
  });

  it('drafted never falls back even if a message has sent_at', () => {
    const c = deriveContext(row(), [{ sentAt: d('2026-03-02T10:00:00Z'), classification: null }]);
    expect(c.firstSentAt).toBeNull();
  });

  it('counts follow-up drafts (sent or not) as due; followUpsSent comes from the column', () => {
    const c = deriveContext(row({ state: 'sent', followUpsSent: 1, firstSentAt: d('2026-03-02T10:00:00Z') }), [
      { sentAt: d('2026-03-02T10:00:00Z'), classification: null },
      { sentAt: d('2026-03-05T10:00:00Z'), classification: 'follow_up_1' },
      { sentAt: null, classification: 'follow_up_2' },
    ]);
    expect(c.followUpsDue).toBe(2);
    expect(c.followUpsSent).toBe(1);
    expect(c.lastOutboundAt).toEqual(d('2026-03-05T10:00:00Z'));
  });
});

describe('follow-up content', () => {
  it('email carries subject and disclosure; no case details', () => {
    const c = followUpContent('email');
    expect(c.subject).toBe('Re: Patient intake inquiry');
    expect(c.body).toContain(AI_DISCLOSURE_EMAIL);
    expect(c.body).toContain(FOLLOW_UP_BODY);
  });
  it('voice has no subject and starts with the spoken disclosure', () => {
    const c = followUpContent('voice');
    expect(c.subject).toBeUndefined();
    expect(c.body.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
  });
});
