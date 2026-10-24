import { describe, expect, it } from 'vitest';
import { approveOutcome, draftsReadyCount, parseMaterialized } from '@/components/plan/model';

const m = (status: string) => ({ resourceKey: 'k', stepId: 's', channel: 'email', status });

describe('approve outcome (drafts from materialized)', () => {
  it('counts only drafted email/voice and drafted applications', () => {
    const items = ['drafted', 'application_drafted', 'scheduled', 'follow_up_plan', 'channel_mismatch', 'blocked'].map(m);
    expect(draftsReadyCount(items as never)).toBe(2);
  });

  it('parses an unknown payload defensively', () => {
    expect(parseMaterialized(undefined)).toEqual([]);
    expect(parseMaterialized([m('drafted'), { nope: 1 }, null])).toHaveLength(1);
  });

  it('says how many drafts are ready, singular and plural', () => {
    expect(approveOutcome([m('drafted')] as never).headline).toBe('1 draft ready in the outbox');
    expect(approveOutcome([m('drafted'), m('application_drafted'), m('drafted')] as never).headline).toBe('3 drafts ready in the outbox');
  });

  it('is honest when there are no drafts', () => {
    const scheduled = approveOutcome([m('scheduled'), m('follow_up_plan')] as never);
    expect(scheduled.count).toBe(0);
    expect(scheduled.headline).toBe('Plan approved. Nothing to review in the outbox yet');
    expect(scheduled.detail).toMatch(/scheduled|follow-up/i);
    const mismatch = approveOutcome([m('channel_mismatch')] as never);
    expect(mismatch.detail).toMatch(/channel/i);
    expect(approveOutcome([]).detail).toMatch(/no drafts/i);
  });
});
