import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { contacts } from '@/db/schema';
import { getCaseActivity, MemoryCaseActivity } from '@/lib/cases/activity';
import type { SafetyContact } from '@/lib/safety/types';
import type { ConsultRequest, CoordinationStore, TargetKind } from '../contract';
import { PostgresCoordinationStore } from '../store';

/**
 * Tracker hook for consultation requests. On send, the expert's consult address becomes (or reuses) a contacts row
 * for the resource, so it shows in the tracker and counts toward the <=5 active contacts cap, and the sent request is
 * stored as an outbound message (classification 'consult_request') so it appears on the timeline and replies thread.
 *
 * Cadence (security review #7): a contact that was already emailed counts this send as a follow-up
 * (followUpsSent + 1); one never emailed gets its first-sent time. The consult record (version CAS) and the tracker
 * rows commit together: in Postgres as ONE statement (atomic), so a lost CAS writes nothing.
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

/** The consult write that must commit with the tracker rows: record.consult saved iff its version is still expectedVersion. */
export interface ConsultCommit { store: CoordinationStore; expectedVersion: number }

export interface ConsultTracker {
  contacts(caseId: string): Promise<SafetyContact[]>;
  /** false = the consult changed concurrently; nothing was written. */
  recordSent(record: ConsultSentRecord, commit: ConsultCommit): Promise<boolean>;
}

type Executor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

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

  async recordSent(r: ConsultSentRecord, commit: ConsultCommit): Promise<boolean> {
    if (!(commit.store instanceof PostgresCoordinationStore)) {
      // Mixed stores (not used in production): CAS first, then the tracker rows.
      if (!await commit.store.save(r.consult.caseId, 'consult', r.consult.id, r.consult, commit.expectedVersion)) return false;
      await this.execute(trackerOnlySql(r));
      return true;
    }
    const result = (await this.execute(consultSentSql(r, commit.expectedVersion))) as { rows?: { committed: number | string }[] };
    return Number(result.rows?.[0]?.committed ?? 0) === 1;
  }

  constructor(private readonly dbOverride?: Executor) {}
  private execute(q: ReturnType<typeof sql>) { return (this.dbOverride ?? this.db).execute(q); }
}

/** CTE body shared by both statements: upsert the contact (cadence-aware) and insert the outbound message. */
function trackerCtes(r: ConsultSentRecord, gate: ReturnType<typeof sql>) {
  const at = r.sentAt;
  const approvedAt = r.consult.patientConsentAt ?? at;
  return sql`
    existing AS (
      SELECT id FROM contacts
      WHERE case_id = ${r.consult.caseId}::uuid AND target_kind = ${r.targetKind} AND target_id = ${r.targetId}::uuid
        AND lower(btrim(address)) = ${r.address} AND ${gate}
      LIMIT 1
    ),
    upd AS (
      UPDATE contacts SET
        state = CASE WHEN state = 'drafted' THEN 'sent'::contact_state ELSE state END,
        last_activity_at = ${at}::timestamptz,
        follow_ups_sent = follow_ups_sent + CASE WHEN first_sent_at IS NOT NULL THEN 1 ELSE 0 END,
        first_sent_at = COALESCE(first_sent_at, ${at}::timestamptz)
      WHERE id IN (SELECT id FROM existing)
      RETURNING id
    ),
    ins AS (
      INSERT INTO contacts (case_id, target_kind, target_id, channel, address, state, last_activity_at, first_sent_at)
      SELECT ${r.consult.caseId}::uuid, ${r.targetKind}, ${r.targetId}::uuid, 'email', ${r.address}, 'sent', ${at}::timestamptz, ${at}::timestamptz
      WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    ),
    cid AS (SELECT id FROM upd UNION ALL SELECT id FROM ins),
    msg AS (
      INSERT INTO messages (contact_id, direction, channel, subject, body, shared_fields, approved_at, sent_at, provider_message_id, provider_thread_id, classification)
      SELECT id, 'outbound', 'email', ${r.consult.subject}, ${r.consult.body}, ${textArray(r.consult.sharedFields)}, ${approvedAt}::timestamptz, ${at}::timestamptz,
        ${r.providerMessageId}, ${r.providerThreadId}, ${CONSULT_MESSAGE_CLASSIFICATION}
      FROM cid
      RETURNING id
    )`;
}

/** Bound parameters only: ARRAY[$1, $2, ...]::text[]. */
function textArray(values: readonly string[]) {
  return values.length ? sql`ARRAY[${sql.join(values.map(v => sql`${v}`), sql`, `)}]::text[]` : sql`ARRAY[]::text[]`;
}

/** One atomic statement: consult CAS + contact upsert + message insert; committed = 1 only when the CAS won. */
export function consultSentSql(r: ConsultSentRecord, expectedVersion: number) {
  const data = JSON.stringify(r.consult);
  return sql`
    WITH c AS (
      UPDATE coordination_records SET data = ${data}::jsonb, version = ${r.consult.version}, token_hash = ${r.consult.reviewTokenHash}, updated_at = now()
      WHERE case_id = ${r.consult.caseId}::uuid AND kind = 'consult' AND key = ${r.consult.id} AND version = ${expectedVersion}
      RETURNING key
    ),
    ${trackerCtes(r, sql`EXISTS (SELECT 1 FROM c)`)}
    SELECT (SELECT count(*) FROM c)::int AS committed, (SELECT count(*) FROM msg)::int AS messages`;
}

function trackerOnlySql(r: ConsultSentRecord) {
  return sql`WITH ${trackerCtes(r, sql`TRUE`)} SELECT (SELECT count(*) FROM msg)::int AS messages`;
}

/** Dev/tests: keeps its own contact rows and mirrors sends into the memory tracker activity when that is in use. */
export class MemoryConsultTracker implements ConsultTracker {
  readonly rows: (SafetyContact & { id: string; caseId: string; targetId: string; address: string })[] = [];
  readonly sent: ConsultSentRecord[] = [];

  async contacts(caseId: string): Promise<SafetyContact[]> {
    return structuredClone(this.rows.filter(r => r.caseId === caseId));
  }

  async recordSent(r: ConsultSentRecord, commit: ConsultCommit): Promise<boolean> {
    if (!await commit.store.save(r.consult.caseId, 'consult', r.consult.id, r.consult, commit.expectedVersion)) return false;
    this.sent.push(structuredClone(r));
    const i = this.rows.findIndex(c => c.caseId === r.consult.caseId && c.targetId === r.targetId && c.address === r.address);
    let row = i >= 0 ? this.rows[i] : undefined;
    if (row) {
      const wasSent = !!row.lastSentAt;
      row = { ...row, state: row.state === 'drafted' ? 'sent' : row.state, lastSentAt: row.lastSentAt ?? r.sentAt, followUpsSent: (row.followUpsSent ?? 0) + (wasSent ? 1 : 0) };
      this.rows[i] = row;
    } else {
      row = { id: crypto.randomUUID(), caseId: r.consult.caseId, targetId: r.targetId, address: r.address, state: 'sent', lastSentAt: r.sentAt, followUpsSent: 0 };
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
    return true;
  }
}
