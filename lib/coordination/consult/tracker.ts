import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contacts, messages } from '@/db/schema';
import { getCaseActivity, MemoryCaseActivity } from '@/lib/cases/activity';
import type { SafetyContact } from '@/lib/safety/types';
import type { ConsultRequest, TargetKind } from '../contract';

/**
 * Tracker hook for consultation requests. On send, the expert's consult address becomes (or reuses) a contacts row
 * for the resource, so it shows in the tracker and counts toward the <=5 active contacts cap, and the sent request is
 * stored as an outbound message (classification 'consult_request') so it appears on the timeline and replies thread.
 */
export interface ConsultSentRecord {
  consult: ConsultRequest;
  targetKind: TargetKind;
  targetId: string;
  address: string;
  sentAt: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
}

export interface ConsultTracker {
  contacts(caseId: string): Promise<SafetyContact[]>;
  recordSent(record: ConsultSentRecord): Promise<void>;
}

export const CONSULT_MESSAGE_CLASSIFICATION = 'consult_request';

export class PostgresConsultTracker implements ConsultTracker {
  private get db() { return getDb(); }

  async contacts(caseId: string): Promise<SafetyContact[]> {
    const rows = await this.db.select().from(contacts).where(eq(contacts.caseId, caseId));
    return rows.map(r => ({
      id: r.id, caseId: r.caseId, targetId: r.targetId, address: r.address, state: r.state,
      lastSentAt: r.firstSentAt ? r.firstSentAt.toISOString() : null, followUpsSent: r.followUpsSent,
    }));
  }

  async recordSent(r: ConsultSentRecord): Promise<void> {
    const at = new Date(r.sentAt);
    const [existing] = await this.db.select({ id: contacts.id }).from(contacts).where(and(
      eq(contacts.caseId, r.consult.caseId), eq(contacts.targetKind, r.targetKind), eq(contacts.targetId, r.targetId),
      sql`lower(btrim(${contacts.address})) = ${r.address}`,
    )).limit(1);
    let contactId = existing?.id;
    if (contactId) {
      await this.db.update(contacts).set({ state: sql`CASE WHEN ${contacts.state} = 'drafted' THEN 'sent'::contact_state ELSE ${contacts.state} END`, lastActivityAt: at }).where(eq(contacts.id, contactId));
    } else {
      const [row] = await this.db.insert(contacts).values({
        caseId: r.consult.caseId, targetKind: r.targetKind, targetId: r.targetId, channel: 'email', address: r.address, state: 'sent', lastActivityAt: at,
      }).returning({ id: contacts.id });
      contactId = row.id;
    }
    await this.db.insert(messages).values({
      contactId, direction: 'outbound', channel: 'email', subject: r.consult.subject, body: r.consult.body,
      sharedFields: [...r.consult.sharedFields], approvedAt: r.consult.patientConsentAt ? new Date(r.consult.patientConsentAt) : at, sentAt: at,
      providerMessageId: r.providerMessageId, providerThreadId: r.providerThreadId, classification: CONSULT_MESSAGE_CLASSIFICATION,
    });
  }
}

/** Dev/tests: keeps its own contact rows and mirrors sends into the memory tracker activity when that is in use. */
export class MemoryConsultTracker implements ConsultTracker {
  readonly rows: (SafetyContact & { id: string; caseId: string; targetId: string; address: string })[] = [];
  readonly sent: ConsultSentRecord[] = [];

  async contacts(caseId: string): Promise<SafetyContact[]> {
    return structuredClone(this.rows.filter(r => r.caseId === caseId));
  }

  async recordSent(r: ConsultSentRecord): Promise<void> {
    this.sent.push(structuredClone(r));
    let row = this.rows.find(c => c.caseId === r.consult.caseId && c.targetId === r.targetId && c.address === r.address);
    if (!row) {
      row = { id: crypto.randomUUID(), caseId: r.consult.caseId, targetId: r.targetId, address: r.address, state: 'sent' };
      this.rows.push(row);
      const activity = getCaseActivity();
      if (activity instanceof MemoryCaseActivity) {
        activity.seedContact(r.consult.caseId, {
          id: row.id, targetKind: r.targetKind, targetId: r.targetId, displayName: r.consult.expertName, channel: 'email', state: 'sent',
          nextFollowUpAt: null, lastActivityAt: r.sentAt, consented: true, approved: true,
        });
      }
    }
    const activity = getCaseActivity();
    if (activity instanceof MemoryCaseActivity) {
      activity.seedMessage(r.consult.caseId, {
        id: crypto.randomUUID(), contactId: row.id, direction: 'outbound', channel: 'email', subject: r.consult.subject, body: r.consult.body,
        sharedFields: [...r.consult.sharedFields], at: r.sentAt, classification: CONSULT_MESSAGE_CLASSIFICATION,
      });
    }
  }
}
