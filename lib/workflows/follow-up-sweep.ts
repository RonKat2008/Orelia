/**
 * Cron-driven follow-ups for deployments without Inngest.
 *
 * A sweep claims contacts whose next_follow_up_at has passed (state 'sent') and drives each through
 * handleFollowUpDue, the same code path the Inngest workflow uses: FOLLOW_UP_DUE transition, then a
 * pre-approved send (walk-away mode, approved_at re-read) or an UNAPPROVED draft for the patient, and
 * a stall after the last follow-up. Nothing here can send except through deps.send.
 *
 * Concurrency: claiming is one atomic UPDATE ... FOR UPDATE SKIP LOCKED that pushes next_follow_up_at
 * out by a lease, so overlapping runs never see the same contact. A successful run overwrites the
 * lease with the next real deadline; a failed run is rolled back (or, if it crashed, retried when the lease
 * expires). Outbound is at-most-once: a failure after a send attempt is not rolled back.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import type { ContactContext } from './connection-machine';
import type { ConnectionDeps } from './connection-workflow';
import { handleFollowUpDue } from './connection-workflow';
import type { WorkflowStep } from './engine';

export const DEFAULT_SWEEP_BATCH = 25;
export const DEFAULT_LEASE_MS = 15 * 60 * 1000;

export interface DueClaim {
  contactId: string;
  caseId: string;
  /** The real deadline that had passed when the contact was claimed. */
  dueAt: Date;
}

export interface FollowUpSweepStore {
  /** Atomically claims up to `limit` due contacts, leasing each until `leaseUntil`. */
  claimDue(input: { now: Date; limit: number; leaseUntil: Date }): Promise<DueClaim[]>;
}

export interface SweepResult {
  claimed: number;
  processed: number;
  stalled: number;
  skipped: number;
  failed: number;
}

/** Runs step functions immediately. Waiting is impossible without a durable engine; events are dropped. */
export function inlineStep(): WorkflowStep {
  return {
    run: async (_id, fn) => fn(),
    async waitForEvent() {
      throw new Error('waitForEvent needs durable scheduling (Inngest); not available inline');
    },
    async sendEvent() {
      return undefined;
    },
  };
}

/**
 * While the lease is in next_follow_up_at the machine would call the follow-up "not due", so show it the real
 * deadline until the first save. Also remembers the original context (to roll back a failure that happened
 * before anything was sent) and whether a send was attempted.
 */
function guarded(deps: ConnectionDeps, claim: DueClaim) {
  let saved = false;
  let original: ContactContext | null = null;
  const state = { sendAttempted: false };
  const wrapped: ConnectionDeps = {
    ...deps,
    async loadContext(contactId) {
      const ctx = await deps.loadContext(contactId);
      if (saved || contactId !== claim.contactId) return ctx;
      original ??= { ...ctx, nextFollowUpAt: claim.dueAt };
      return { ...ctx, nextFollowUpAt: claim.dueAt };
    },
    async saveContext(contactId, ctx) {
      await deps.saveContext(contactId, ctx);
      if (contactId === claim.contactId) saved = true;
    },
    async send(input) {
      state.sendAttempted = true;
      return deps.send(input);
    },
  };
  /** Puts the contact back on its original deadline so the next sweep retries it. Never after a send attempt: that could double-send. */
  const rollback = async () => {
    if (state.sendAttempted || !original) return;
    await deps.saveContext(claim.contactId, original);
  };
  return { wrapped, rollback };
}

export async function runFollowUpSweep(opts: {
  store: FollowUpSweepStore;
  deps: ConnectionDeps;
  limit?: number;
  leaseMs?: number;
}): Promise<SweepResult> {
  const now = opts.deps.clock.now();
  const claims = await opts.store.claimDue({
    now,
    limit: opts.limit ?? DEFAULT_SWEEP_BATCH,
    leaseUntil: new Date(now.getTime() + (opts.leaseMs ?? DEFAULT_LEASE_MS)),
  });
  const result: SweepResult = { claimed: claims.length, processed: 0, stalled: 0, skipped: 0, failed: 0 };
  for (const claim of claims) {
    const g = guarded(opts.deps, claim);
    try {
      const out = await handleFollowUpDue(g.wrapped, inlineStep(), {
        contactId: claim.contactId,
        caseId: claim.caseId,
        phase: 'cron',
        deadlineReal: claim.dueAt.toISOString(),
      });
      if (out.outcome === 'stalled') result.stalled += 1;
      else if (out.outcome) result.skipped += 1;
      else result.processed += 1;
    } catch (err) {
      // Retry on the next sweep: roll back to the original deadline, or if that fails the lease expires.
      // After a send attempt nothing is rolled back (at-most-once outbound). Log the class only, never message text.
      result.failed += 1;
      await g.rollback().catch(() => undefined);
      console.error('[cron/follow-ups] contact failed', claim.contactId, err instanceof Error ? err.name : 'error');
    }
  }
  return result;
}

export class PostgresFollowUpSweepStore implements FollowUpSweepStore {
  async claimDue({ now, limit, leaseUntil }: { now: Date; limit: number; leaseUntil: Date }): Promise<DueClaim[]> {
    const res = await getDb().execute(sql`
      UPDATE contacts c
      SET next_follow_up_at = ${leaseUntil.toISOString()}::timestamptz
      FROM (
        SELECT id, next_follow_up_at AS due
        FROM contacts
        WHERE state = 'sent' AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ${now.toISOString()}::timestamptz
        ORDER BY next_follow_up_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      ) d
      WHERE c.id = d.id
      RETURNING c.id AS id, c.case_id AS case_id, d.due AS due
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as {
      id: string; case_id: string; due: string | Date;
    }[];
    return rows.map((r) => ({ contactId: String(r.id), caseId: String(r.case_id), dueAt: new Date(r.due) }));
  }
}

/** In-memory store for tests: same claim semantics, backed by the contexts the deps read and write. */
export class InMemoryFollowUpSweepStore implements FollowUpSweepStore {
  constructor(
    private readonly contexts: Map<string, ContactContext>,
    private readonly caseId = 'case-1',
  ) {}
  async claimDue({ now, limit, leaseUntil }: { now: Date; limit: number; leaseUntil: Date }): Promise<DueClaim[]> {
    const due = [...this.contexts.entries()]
      .filter(([, c]) => c.state === 'sent' && c.nextFollowUpAt && c.nextFollowUpAt.getTime() <= now.getTime())
      .sort(([, a], [, b]) => a.nextFollowUpAt!.getTime() - b.nextFollowUpAt!.getTime())
      .slice(0, limit);
    return due.map(([contactId, c]) => {
      const dueAt = c.nextFollowUpAt!;
      this.contexts.set(contactId, { ...c, nextFollowUpAt: leaseUntil });
      return { contactId, caseId: this.caseId, dueAt };
    });
  }
}
