/**
 * Which mechanism drives the business-day follow-up timers.
 * - inngest: durable Inngest workflows (keys, or a local dev server).
 * - cron: Vercel Cron hits /api/cron/follow-ups (needs CRON_SECRET) and sweeps contacts.next_follow_up_at.
 * - none: nothing schedules follow-ups; the patient must write and approve them by hand.
 * Pure env inspection; no imports, so the health route and UI can use it freely.
 */
type Env = Record<string, string | undefined>;

export type FollowUpScheduler = 'inngest' | 'cron' | 'none';

const set = (v: string | undefined) => (v ?? '').trim() !== '';

/** True when durable Inngest scheduling works: both Inngest keys, or a local Inngest dev server. */
export function schedulingConnected(env: Env = process.env): boolean {
  const devServer = set(env.INNGEST_DEV) && env.INNGEST_DEV !== '0';
  return devServer || (set(env.INNGEST_EVENT_KEY) && set(env.INNGEST_SIGNING_KEY));
}

export function cronConfigured(env: Env = process.env): boolean {
  return set(env.CRON_SECRET);
}

export function followUpScheduler(env: Env = process.env): FollowUpScheduler {
  if (schedulingConnected(env)) return 'inngest';
  return cronConfigured(env) ? 'cron' : 'none';
}
