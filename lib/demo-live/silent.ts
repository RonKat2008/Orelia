/**
 * DEMO ONLY: which demo threads the coordinator leaves unanswered. A resource whose plan says "email, then call if
 * there is no reply" must stay silent, or the follow-up call (the point of that combination) would never happen.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { contacts, contactPlans, messages } from '../../db/schema';
import type { ContactPlan } from '../plan/contract';

/** Pure rule: the resource has an enabled voice step that waits for a reply that never came. */
export function planWantsSilence(plan: Pick<ContactPlan, 'resources'> | null, contactId: string, targetKey: string): boolean {
  const resource = plan?.resources.find((r) => r.contactId === contactId || r.resourceKey === targetKey);
  if (!resource) return false;
  const steps = resource.steps.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const emailIdx = steps.findIndex((s) => s.channel === 'email');
  return emailIdx >= 0 && steps.slice(emailIdx + 1).some((s) => s.channel === 'voice' && s.waitFor !== 'none');
}

export async function isSilentDemoThread(threadId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ contactId: contacts.id, caseId: contacts.caseId, targetKind: contacts.targetKind, targetId: contacts.targetId })
    .from(messages)
    .innerJoin(contacts, eq(messages.contactId, contacts.id))
    .where(eq(messages.providerThreadId, threadId))
    .limit(1);
  if (!row) return false;
  const [planRow] = await db.select({ plan: contactPlans.plan }).from(contactPlans).where(eq(contactPlans.caseId, row.caseId)).limit(1);
  return planWantsSilence((planRow?.plan ?? null) as unknown as ContactPlan | null, row.contactId, `${row.targetKind}:${row.targetId}`);
}
