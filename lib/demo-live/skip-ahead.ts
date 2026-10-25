/**
 * DEMO ONLY: simulated time for the live demo case. "Skip ahead" moves every waiting contact of ONE demo case back in
 * time (its first send and outbound messages shift 5 calendar days earlier, which is at least 3 business days) and
 * makes its follow-up due now; lane F's resource agents on the case are woken too. Then the normal cron tick runs, so
 * the follow-up is produced by exactly the code that runs in production every minute. Nothing is sent by the shift:
 * a follow-up still needs approval (or the patient's pre-approved walk-away plan) and checkOutbound.
 *
 * Only a case seeded by the live demo (it carries `fictional_demo_resource` evidence) can be shifted.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { contacts, evidence } from '../../db/schema';

export const SKIP_AHEAD_MS = 5 * 24 * 60 * 60 * 1000;
export const DEMO_MARKER_CLAIM = 'fictional_demo_resource';

export async function isLiveDemoCase(caseId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: evidence.id })
    .from(evidence)
    .where(and(eq(evidence.caseId, caseId), eq(evidence.claimType, DEMO_MARKER_CLAIM)))
    .limit(1);
  return Boolean(row);
}

export async function skipAhead(caseId: string, now = new Date()): Promise<{ shifted: number; agentsWoken: number }> {
  const db = getDb();
  const shift = `${SKIP_AHEAD_MS} milliseconds`;
  const waiting = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.caseId, caseId), eq(contacts.state, 'sent')));
  for (const c of waiting) {
    await db.execute(sql`
      UPDATE messages SET sent_at = sent_at - ${shift}::interval
      WHERE contact_id = ${c.id} AND direction = 'outbound' AND sent_at IS NOT NULL
    `);
    await db.execute(sql`
      UPDATE contacts SET first_sent_at = COALESCE(first_sent_at, ${now.toISOString()}::timestamptz) - ${shift}::interval,
        last_activity_at = COALESCE(last_activity_at, ${now.toISOString()}::timestamptz) - ${shift}::interval,
        next_follow_up_at = ${now.toISOString()}::timestamptz
      WHERE id = ${c.id}
    `);
  }
  let agentsWoken = 0;
  try {
    const reg = await db.execute(sql`SELECT to_regclass('public.resource_agents') AS t`);
    const rows = (Array.isArray(reg) ? reg : (reg as unknown as { rows: { t: unknown }[] }).rows) as { t: unknown }[];
    if (rows[0]?.t) {
      const res = await db.execute(sql`
        UPDATE resource_agents SET next_action_at = ${now.toISOString()}::timestamptz
        WHERE case_id = ${caseId} AND state NOT IN ('done', 'failed') RETURNING id
      `);
      agentsWoken = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows).length;
    }
  } catch (err) {
    console.error('[demo-live] waking resource agents failed', err instanceof Error ? err.name : 'error');
  }
  return { shifted: waiting.length, agentsWoken };
}
