/**
 * The per-minute cron tick (Vercel Cron -> /api/cron/follow-ups). Everything that must keep happening while nobody
 * has the app open runs here, server-side: due follow-ups (and plan steps that wait on business days), the demo
 * coordinator's scripted replies, and (lane F) resource agents that are due to wake.
 *
 * Overlap safety: Vercel may start a tick while the previous one still runs. Every step claims its work atomically
 * (UPDATE ... FOR UPDATE SKIP LOCKED leases, or OnceStore keys), so two ticks never act on the same item and nothing
 * is sent twice. Steps are isolated: one failing step never stops the others. See docs/DEMO-LIVE.md (persistence).
 */
import { schedulingConnected } from './scheduler';

type Env = Record<string, string | undefined>;

export interface TickContext {
  now: Date;
  /** Epoch ms; steps stop claiming new work after this. */
  deadline: number;
  env: Env;
}

export interface TickStep {
  name: string;
  enabled?(env: Env): boolean;
  run(ctx: TickContext): Promise<Record<string, unknown>>;
}

export interface TickResult {
  ok: boolean;
  steps: Record<string, Record<string, unknown>>;
}

/** Whole-tick budget: under the route's maxDuration (120 s), with room for the response. */
export const TICK_BUDGET_MS = 90_000;

export const followUpsStep: TickStep = {
  name: 'followUps',
  // Inngest owns the timers when it is connected; sweeping too could double-handle a contact.
  enabled: (env) => !schedulingConnected(env) && Boolean(env.DATABASE_URL),
  async run() {
    const [{ runFollowUpSweep, PostgresFollowUpSweepStore }, { createDefaultDeps }] = await Promise.all([
      import('./follow-up-sweep'),
      import('./default-deps'),
    ]);
    const r = await runFollowUpSweep({ store: new PostgresFollowUpSweepStore(), deps: createDefaultDeps() });
    return { ...r };
  },
};

export const demoResponderStep: TickStep = {
  name: 'demoResponder',
  enabled: (env) => Boolean(env.DATABASE_URL),
  async run(ctx) {
    const [{ runDemoResponder, responderEnabled }, { createDemoMail }, { PostgresOnceStore }, { isSilentDemoThread }] = await Promise.all([
      import('../demo-live/responder'),
      import('../../scripts/demo/agentmail-mail'),
      import('./once'),
      import('../demo-live/silent'),
    ]);
    if (!responderEnabled(ctx.env)) return { enabled: false };
    const r = await runDemoResponder({
      env: ctx.env,
      mail: createDemoMail({ env: ctx.env }),
      once: new PostgresOnceStore(),
      now: ctx.now,
      isSilentThread: isSilentDemoThread,
    });
    return { ...r };
  },
};

/** Lane F adds its resource-agent wake step here (see scratchpad briefs/r3-lease-contract.md). */
export const TICK_STEPS: TickStep[] = [followUpsStep, demoResponderStep];

export async function runCronTick(opts: { env?: Env; now?: Date; steps?: TickStep[] } = {}): Promise<TickResult> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const ctx: TickContext = { now, deadline: now.getTime() + TICK_BUDGET_MS, env };
  const steps: TickResult['steps'] = {};
  let ok = true;
  for (const step of opts.steps ?? TICK_STEPS) {
    if (step.enabled && !step.enabled(env)) {
      steps[step.name] = { skipped: 'disabled' };
      continue;
    }
    try {
      const out = await step.run(ctx);
      steps[step.name] = out;
      if (typeof out.failed === 'number' && out.failed > 0) ok = false;
    } catch (err) {
      ok = false;
      steps[step.name] = { error: err instanceof Error ? err.name : 'error' };
      console.error(`[cron/tick] step ${step.name} failed`, err instanceof Error ? err.name : 'error');
    }
  }
  return { ok, steps };
}
