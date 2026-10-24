import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from './types';
const normAddress = (address: string) => address.trim().toLowerCase();
/**
 * Pure dedupe decision: a proposed contact is skipped only when a contact with the same normalized address
 * already exists in the case (or an earlier proposal carries it). Same target + different address is kept.
 * The SQL in PostgresOutreachStore.select mirrors this (lower(btrim(address))).
 */
export function dedupeProposedContacts<T extends { address: string }>(existing: { address: string }[], proposed: T[]): T[] {
  const seen = new Set(existing.map(c => normAddress(c.address)));
  return proposed.filter(p => { const key = normAddress(p.address); if (seen.has(key)) return false; seen.add(key); return true; });
}
/** All draft channels use messages for draft identity; delivered voice drafts additionally create calls. */
export class PostgresOutreachStore implements OutreachStore {
  private get db() { return getDb(); }
  async getCase(id: string) {
    const [record] = await this.db.select().from(s.cases).where(eq(s.cases.id, id));
    if (!record) return undefined;
    // Only patient fields belong in the privacy scanner (not database IDs/status/timestamps).
    const { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals } = record;
    return { diseaseName, diseaseCodes, subtype, stageSummary, homeCity, homeState, insurer, planId, travelLimitMiles, goals };
  }
  async candidates(caseId: string, ids: string[]): Promise<Candidate[]> {
    const rows = await this.db.select().from(s.caseCandidates).where(and(eq(s.caseCandidates.caseId, caseId), inArray(s.caseCandidates.id, ids)));
    return Promise.all(rows.map(async row => {
      const evidence = await this.db.select().from(s.evidence).where(and(eq(s.evidence.caseId, caseId), eq(s.evidence.targetId, row.targetId), eq(s.evidence.targetKind, row.targetKind)));
      const [org] = row.targetKind === 'organization' ? await this.db.select().from(s.organizations).where(eq(s.organizations.id, row.targetId)) : [];
      return { ...row, evidence, purpose: org?.kind };
    }));
  }
  async contacts(caseId: string): Promise<Contact[]> { return this.db.select().from(s.contacts).where(eq(s.contacts.caseId, caseId)); }
  async contact(id: string): Promise<Contact | undefined> {
    const [contact] = await this.db.select().from(s.contacts).where(eq(s.contacts.id, id));
    if (!contact) return undefined;
    const [org] = contact.targetKind === 'organization' ? await this.db.select().from(s.organizations).where(eq(s.organizations.id, contact.targetId)) : [];
    return { ...contact, purpose: org?.kind };
  }
  async select(caseId: string, proposed: Contact[], cap: number): Promise<Contact[]> {
    if (!proposed.length) return [];
    const payload = JSON.stringify(proposed);
    // Lock case first; the following statement gets a fresh READ COMMITTED snapshot after lock acquisition.
    const result = await this.db.batch([
      this.db.update(s.cases).set({ status: sql`${s.cases.status}` }).where(eq(s.cases.id, caseId)).returning({ id: s.cases.id }),
      this.db.execute(sql`
        WITH proposed AS (
          SELECT * FROM jsonb_to_recordset(${payload}::jsonb)
          AS p(id uuid, "caseId" uuid, "targetId" uuid, "targetKind" text, channel text, address text)
        ), fresh AS (
          SELECT DISTINCT ON (lower(btrim(p.address))) p.* FROM proposed p WHERE NOT EXISTS (
            SELECT 1 FROM contacts c WHERE c.case_id = ${caseId}::uuid AND lower(btrim(c.address)) = lower(btrim(p.address))
          )
        ), inserted AS (
          INSERT INTO contacts (id, case_id, target_id, target_kind, channel, address, state)
          SELECT id, "caseId", "targetId", "targetKind"::target_kind, channel::channel, address, 'drafted'
          FROM fresh WHERE (SELECT count(*) FROM contacts WHERE case_id = ${caseId}::uuid AND state NOT IN ('declined','stalled','appointment_booked','connected')) + (SELECT count(*) FROM fresh) <= ${cap}
          RETURNING id
        ) SELECT id FROM inserted
      `),
    ]);
    const inserted = result[1].rows as { id: string }[];
    const all = await this.contacts(caseId);
    const present = (p: Contact) => all.some(c => normAddress(c.address) === normAddress(p.address));
    if (!inserted.length && proposed.some(p => !present(p))) throw new OutreachError(422, ['contact_cap']);
    return all.filter(c => proposed.some(p => normAddress(c.address) === normAddress(p.address)));
  }
  async consent(id: string): Promise<Consent | undefined> {
    const [row] = await this.db.select().from(s.consents).where(eq(s.consents.contactId, id));
    return row?.approvedAt ? { contactId: id, sharedFields: row.sharedFields, approvedAt: row.approvedAt.toISOString() } : undefined;
  }
  async saveConsent(consent: Consent) {
    await this.db.batch([
      this.db.update(s.contacts).set({ lastActivityAt: new Date(consent.approvedAt) }).where(eq(s.contacts.id, consent.contactId)),
      this.db.delete(s.consents).where(eq(s.consents.contactId, consent.contactId)),
      this.db.insert(s.consents).values({ ...consent, approvedAt: new Date(consent.approvedAt) }),
    ]);
  }
  async saveDraft(draft: Draft) {
    await this.db.insert(s.messages).values({ id: draft.id, contactId: draft.contactId, channel: draft.channel, direction: 'outbound', subject: draft.subject, body: draft.body, sharedFields: draft.sharedFields });
  }
  async draft(id: string, contact: Contact): Promise<Draft | undefined> {
    const [row] = await this.db.select().from(s.messages).where(and(eq(s.messages.id, id), eq(s.messages.contactId, contact.id), eq(s.messages.direction, 'outbound')));
    return row ? { ...row, subject: row.subject ?? undefined, caseId: contact.caseId, address: contact.address, approvedAt: row.approvedAt?.toISOString(), sentAt: row.sentAt?.toISOString() } : undefined;
  }
  async reserve(draft: Draft, approvedAt: string) {
    const result = await this.db.batch([
      this.db.update(s.contacts).set({ lastActivityAt: new Date(approvedAt) }).where(eq(s.contacts.id, draft.contactId)),
      this.db.execute(sql`
        UPDATE messages SET approved_at = ${approvedAt}::timestamptz
        WHERE id = ${draft.id}::uuid AND contact_id = ${draft.contactId}::uuid AND approved_at IS NULL AND sent_at IS NULL
          AND body = ${draft.body} AND COALESCE(subject, '') = ${draft.subject ?? ''}
          AND EXISTS (SELECT 1 FROM consents WHERE contact_id = ${draft.contactId}::uuid AND approved_at IS NOT NULL AND shared_fields = ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(draft.sharedFields)}::jsonb)))
          AND EXISTS (SELECT 1 FROM contacts WHERE id = ${draft.contactId}::uuid AND state = 'drafted' AND address = ${draft.address})
        AND NOT EXISTS (SELECT 1 FROM messages other WHERE other.contact_id = ${draft.contactId}::uuid AND other.id <> ${draft.id}::uuid AND other.direction = 'outbound' AND other.approved_at IS NOT NULL)
        RETURNING id
      `),
    ]);
    return result[1].rows.length === 1;
  }
  async delivered(draft: Draft, ref: ProviderRef, sentAt: string) {
    const message = this.db.update(s.messages).set({ sentAt: new Date(sentAt), providerMessageId: ref.messageId, providerThreadId: ref.threadId }).where(eq(s.messages.id, draft.id));
    const contact = this.db.update(s.contacts).set({ state: 'sent', lastActivityAt: new Date(sentAt) }).where(eq(s.contacts.id, draft.contactId));
    if (draft.channel === 'voice') {
      await this.db.batch([message, contact, this.db.insert(s.calls).values({ contactId: draft.contactId, toNumber: draft.address, script: draft.body, approvedAt: new Date(sentAt), startedAt: new Date(sentAt), providerCallId: ref.callId })]);
    } else await this.db.batch([message, contact]);
  }
}
