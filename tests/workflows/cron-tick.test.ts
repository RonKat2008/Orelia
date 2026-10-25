import { describe, expect, it, vi } from 'vitest';
import { followUpDeadlines, initialContext } from '../../lib/workflows/connection-machine';
import { InMemoryContactContextStore } from '../../lib/workflows/contact-store';
import { createDurableDeps } from '../../lib/workflows/default-deps';
import { InMemoryFollowUpSweepStore, runFollowUpSweep } from '../../lib/workflows/follow-up-sweep';
import { runCronTick, type TickStep } from '../../lib/workflows/cron-tick';
import type { ConnectionDeps } from '../../lib/workflows/connection-workflow';

const FIRST = new Date('2026-10-26T12:00:00.000Z');
const DAY3 = followUpDeadlines(FIRST).followUp1;

/** Five contacts with a PRE-APPROVED (walk-away) day-3 follow-up: the sweep sends without asking again. */
function preapprovedWorld(now: Date) {
  const store = new InMemoryContactContextStore();
  for (let i = 1; i <= 5; i++) {
    store.contexts.set(`c${i}`, { ...initialContext(), state: 'sent', firstSentAt: FIRST, lastOutboundAt: FIRST, nextFollowUpAt: DAY3 });
    store.approvals.set(`plan-c${i}`, '2026-10-27T00:00:00.000Z');
  }
  const send = vi.fn(async (input: unknown) => {
    void input;
    await new Promise((r) => setTimeout(r, 5)); // a slow provider widens the overlap window
    return { providerRef: 'pm' };
  });
  const deps: ConnectionDeps = {
    ...createDurableDeps({ store, send, env: {} }),
    clock: { now: () => now, scale: 1 },
    resolvePreapproved: async ({ contactId }: { contactId: string }) => ({ action: 'send', messageId: `plan-${contactId}`, body: 'b' }),
  } as ConnectionDeps;
  return { store, send, deps, sweepStore: new InMemoryFollowUpSweepStore(store.contexts) };
}

describe('cron tick: persistence without the browser', () => {
  it('four overlapping per-minute ticks send each due follow-up exactly once', async () => {
    const w = preapprovedWorld(new Date('2026-10-29T13:00:00.000Z'));
    const step: TickStep = { name: 'followUps', run: async () => ({ ...(await runFollowUpSweep({ store: w.sweepStore, deps: w.deps })) }) };
    const results = await Promise.all([1, 2, 3, 4].map(() => runCronTick({ env: {}, steps: [step] })));
    const claimed = results.reduce((n, r) => n + Number(r.steps.followUps!.claimed), 0);
    expect(claimed).toBe(5);
    expect(w.send).toHaveBeenCalledTimes(5);
    const sentTo = w.send.mock.calls.map((c) => (c[0] as { contactId: string }).contactId).sort();
    expect(sentTo).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    // A later tick finds nothing new to do (the lease was replaced by the day-7 deadline).
    const again = await runCronTick({ env: {}, steps: [step] });
    expect(again.steps.followUps).toMatchObject({ claimed: 0 });
    expect(w.send).toHaveBeenCalledTimes(5);
  });

  it('a failing step never stops the others, and the tick reports not ok', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ran: string[] = [];
    const steps: TickStep[] = [
      { name: 'a', run: async () => { throw new Error('boom'); } },
      { name: 'b', run: async () => { ran.push('b'); return { n: 1 }; } },
      { name: 'c', enabled: () => false, run: async () => { ran.push('c'); return {}; } },
    ];
    const r = await runCronTick({ env: {}, steps });
    expect(r.ok).toBe(false);
    expect(r.steps).toEqual({ a: { error: 'Error' }, b: { n: 1 }, c: { skipped: 'disabled' } });
    expect(ran).toEqual(['b']);
    vi.restoreAllMocks();
  });

  it('skips the follow-up sweep while Inngest owns the timers', async () => {
    const r = await runCronTick({ env: { INNGEST_EVENT_KEY: 'k', INNGEST_SIGNING_KEY: 's', DATABASE_URL: 'postgres://x' }, steps: [(await import('../../lib/workflows/cron-tick')).followUpsStep] });
    expect(r.steps.followUps).toEqual({ skipped: 'disabled' });
  });
});

describe('vercel cron cadence', () => {
  it('runs the tick every minute', async () => {
    const { config } = await import('../../vercel');
    expect(config.crons).toContainEqual({ path: '/api/cron/follow-ups', schedule: '* * * * *' });
  });
});
