import { describe, expect, it, vi } from 'vitest';
import { followUpDeadlines, initialContext, type ContactContext } from '../../lib/workflows/connection-machine';
import { InMemoryContactContextStore } from '../../lib/workflows/contact-store';
import { createDurableDeps } from '../../lib/workflows/default-deps';
import { InMemoryFollowUpSweepStore, runFollowUpSweep } from '../../lib/workflows/follow-up-sweep';
import type { ConnectionDeps } from '../../lib/workflows/connection-workflow';

// Mon 2026-10-26 12:00Z first send -> business day 3 = Thu 10-29, day 7 = Wed 11-04, day 10 = Mon 11-09.
const FIRST = new Date('2026-10-26T12:00:00.000Z');
const DAY3 = followUpDeadlines(FIRST).followUp1;
const { followUp2: DAY7, stall: DAY10 } = followUpDeadlines(FIRST);

function setup(start: Partial<ContactContext>, now: { t: Date }, over: Partial<ConnectionDeps> = {}) {
  const store = new InMemoryContactContextStore();
  store.contexts.set('c1', { ...initialContext(), state: 'sent', firstSentAt: FIRST, lastOutboundAt: FIRST, nextFollowUpAt: DAY3, ...start });
  const send = vi.fn(async () => ({ providerRef: 'pm' }));
  const deps: ConnectionDeps = {
    ...createDurableDeps({ store, send, env: {} }),
    clock: { now: () => now.t, scale: 1 },
    ...over,
  };
  const sweepStore = new InMemoryFollowUpSweepStore(store.contexts);
  return { store, send, deps, sweepStore, ctx: () => store.contexts.get('c1')! };
}

describe('runFollowUpSweep', () => {
  it('does nothing before the follow-up is due', async () => {
    const now = { t: new Date('2026-10-29T11:59:00.000Z') };
    const s = setup({}, now);
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 0 });
    expect(s.store.drafts).toEqual([]);
  });

  it('drafts an UNAPPROVED follow-up when due and schedules day 7', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    const s = setup({}, now);
    const res = await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(res).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
    expect(s.store.drafts).toHaveLength(1);
    expect(s.store.drafts[0]).toMatchObject({ contactId: 'c1', followUpNumber: 1 });
    expect(s.store.approvals.size).toBe(0);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.ctx().state).toBe('sent');
    expect(s.ctx().nextFollowUpAt?.toISOString()).toBe(DAY7.toISOString());
  });

  it('is idempotent: a second run, and two overlapping runs, act once', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    const s = setup({}, now);
    const [a, b] = await Promise.all([
      runFollowUpSweep({ store: s.sweepStore, deps: s.deps }),
      runFollowUpSweep({ store: s.sweepStore, deps: s.deps }),
    ]);
    expect(a.claimed + b.claimed).toBe(1);
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 0 });
    expect(s.store.drafts).toHaveLength(1);
  });

  it('rolls a failed run back (nothing sent) so the next sweep retries it', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    let fail = true;
    const s = setup({}, now, { draftFollowUp: async (i) => { if (fail) throw new Error('db down'); return s.store.createFollowUpDraft(i); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 1, failed: 1 });
    expect(s.ctx().nextFollowUpAt?.toISOString()).toBe(DAY3.toISOString());
    fail = false;
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 1, processed: 1 });
    expect(s.store.drafts).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('does not claim a leased contact until the lease expires', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    const s = setup({}, now);
    s.store.contexts.set('c1', { ...s.ctx(), nextFollowUpAt: new Date('2026-10-29T13:10:00.000Z') });
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 0 });
    now.t = new Date('2026-10-29T13:11:00.000Z');
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 1 });
  });

  it('does not roll back after a send attempt (at-most-once outbound)', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    const s = setup({}, now, { resolvePreapproved: async () => ({ action: 'send', messageId: 'plan-1', body: 'b' }) });
    s.store.approvals.set('plan-1', '2026-10-27T00:00:00.000Z');
    s.send.mockRejectedValueOnce(new Error('provider down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ failed: 1 });
    expect(s.ctx().nextFollowUpAt?.toISOString()).toBe(DAY7.toISOString());
    vi.restoreAllMocks();
  });

  it('moves a contact to stalled after follow-up 2 with no reply, sending nothing', async () => {
    const now = { t: new Date('2026-11-09T13:00:00.000Z') };
    const s = setup({ followUpsDue: 2, followUpsSent: 1, nextFollowUpAt: DAY10 }, now);
    const res = await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(res).toMatchObject({ claimed: 1, stalled: 1 });
    expect(s.ctx().state).toBe('stalled');
    expect(s.ctx().nextFollowUpAt).toBeNull();
    expect(s.send).not.toHaveBeenCalled();
    expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 0 });
  });

  it('drafts follow-up 2 at day 7, then stalls at day 10', async () => {
    const now = { t: new Date('2026-11-04T13:00:00.000Z') };
    const s = setup({ followUpsDue: 1, followUpsSent: 1, nextFollowUpAt: DAY7 }, now);
    await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(s.store.drafts.at(-1)).toMatchObject({ followUpNumber: 2 });
    expect(s.ctx().nextFollowUpAt?.toISOString()).toBe(DAY10.toISOString());
  });

  it('never claims replied, declined or stalled contacts', async () => {
    const now = { t: new Date('2026-11-20T13:00:00.000Z') };
    for (const state of ['replied', 'declined', 'stalled'] as const) {
      const s = setup({ state }, now);
      expect(await runFollowUpSweep({ store: s.sweepStore, deps: s.deps })).toMatchObject({ claimed: 0 });
    }
  });

  it('bounds the batch size', async () => {
    const now = { t: new Date('2026-10-29T13:00:00.000Z') };
    const s = setup({}, now);
    for (const id of ['c2', 'c3', 'c4']) s.store.contexts.set(id, { ...s.ctx() });
    const res = await runFollowUpSweep({ store: s.sweepStore, deps: s.deps, limit: 2 });
    expect(res.claimed).toBe(2);
  });
});

describe('runFollowUpSweep keeps the outbound gate', () => {
  const preapproved = () => async () => ({ action: 'send' as const, messageId: 'plan-1', body: 'b' });
  const now = () => ({ t: new Date('2026-10-29T13:00:00.000Z') });

  it('sends a pre-approved follow-up only when messages.approved_at is set, through deps.send', async () => {
    const s = setup({}, now(), { resolvePreapproved: preapproved() });
    s.store.approvals.set('plan-1', '2026-10-27T00:00:00.000Z');
    const res = await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(res.failed).toBe(0);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'c1', messageId: 'plan-1', kind: 'follow_up' }));
    expect(s.ctx().followUpsSent).toBe(1);
    expect(s.store.drafts).toEqual([]);
  });

  it('falls back to an unapproved draft and sends nothing when approved_at is missing', async () => {
    const s = setup({}, now(), { resolvePreapproved: preapproved() });
    await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.store.drafts).toHaveLength(1);
  });

  it('holds (notifies, drafts, no send) when the plan says hold', async () => {
    const notify = vi.fn(async () => {});
    const s = setup({}, now(), {
      resolvePreapproved: async () => ({ action: 'hold', reason: 'not_preapproved' }),
      notifyApprovalNeeded: notify,
    });
    await runFollowUpSweep({ store: s.sweepStore, deps: s.deps });
    expect(notify).toHaveBeenCalledOnce();
    expect(s.send).not.toHaveBeenCalled();
    expect(s.store.drafts).toHaveLength(1);
  });
});
