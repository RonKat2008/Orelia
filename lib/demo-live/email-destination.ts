/**
 * DEMO ONLY: where one live-demo case's TEST emails go (see lib/outreach/demo-email-destination.ts for the rules).
 *
 * Stored with no schema change: one evidence row per case with the reserved claimType below, attached to a
 * synthetic target (kind 'organization', id = the case id) so no real resource's evidence ever includes it. The value
 * is exactly 'scripted' or 'personal'; anything else reads as "no choice". The row never holds an address.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { contacts, evidence } from '../../db/schema';
import { demoEmailAddressFor, emailDestinationGroups, parseEmailChoice, type EmailDestinationChoice } from '../outreach/demo-email-destination';

type Env = Record<string, string | undefined>;

export const EMAIL_DESTINATION_CLAIM = 'demo_setting.email_destination';

export async function getEmailDestinationChoice(caseId: string): Promise<EmailDestinationChoice | undefined> {
  const [row] = await getDb()
    .select({ claim: evidence.claim })
    .from(evidence)
    .where(and(eq(evidence.caseId, caseId), eq(evidence.claimType, EMAIL_DESTINATION_CLAIM)))
    .limit(1);
  return parseEmailChoice(row?.claim);
}

export async function setEmailDestinationChoice(caseId: string, choice: EmailDestinationChoice, now = new Date()): Promise<void> {
  const db = getDb();
  await db.batch([
    db.delete(evidence).where(and(eq(evidence.caseId, caseId), eq(evidence.claimType, EMAIL_DESTINATION_CLAIM))),
    db.insert(evidence).values({
      caseId, targetKind: 'organization', targetId: caseId, claimType: EMAIL_DESTINATION_CLAIM, claim: choice,
      sourceUrl: 'https://orelia.invalid/demo-setting', sourceKind: 'exa', fetchedAt: now,
    }),
  ]);
}

/**
 * Moves this case's email contacts that have not been written to yet to the chosen group's inbox, so the console
 * shows the right label straight away (send time re-checks, see OutreachService.approve). Only demo inboxes move;
 * a contact already contacted keeps its address (its thread is there).
 */
export async function rerouteDraftedEmailContacts(caseId: string, env: Env, choice: EmailDestinationChoice): Promise<number> {
  const db = getDb();
  const g = emailDestinationGroups(env);
  const demoInboxes = new Set([...g.scripted, ...g.personal]);
  const rows = await db.select().from(contacts).where(and(eq(contacts.caseId, caseId), eq(contacts.state, 'drafted'), eq(contacts.channel, 'email')));
  let moved = 0;
  for (const c of rows) {
    if (!demoInboxes.has(c.address.trim().toLowerCase())) continue;
    const target = demoEmailAddressFor(env, choice, `${c.targetKind}:${c.targetId}`);
    if (!target || target === c.address.trim().toLowerCase()) continue;
    const done = await db.update(contacts).set({ address: target }).where(and(eq(contacts.id, c.id), eq(contacts.state, 'drafted'))).returning({ id: contacts.id });
    moved += done.length;
  }
  return moved;
}
