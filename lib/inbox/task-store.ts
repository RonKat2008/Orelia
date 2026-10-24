import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import type { TaskDraft } from './drafts';

export type StoredTask = Omit<TaskDraft, 'status' | 'approvedAt'> & {
  id: string;
  createdAt: string;
  status: 'open' | 'approved' | 'done';
  approvedAt: string | null;
};
export interface NextCandidate { id: string; name?: string; targetKind: string; targetId: string }

/** Persistence for inbox-generated tasks. Approving a task never sends anything; see approve.ts. */
export interface TaskStore {
  saveTasks(drafts: TaskDraft[]): Promise<StoredTask[]>;
  task(id: string): Promise<StoredTask | undefined>;
  /** Compare-and-set open -> approved. False if the task was not open. */
  markApproved(id: string, at: string): Promise<boolean>;
  /** Undo markApproved (approved -> open) when a later step fails. */
  reopen(id: string): Promise<void>;
  markDone(id: string): Promise<void>;
  /** Highest-ranked case candidate that has no contact yet. */
  nextCandidate(caseId: string): Promise<NextCandidate | undefined>;
  closeContact(contactId: string): Promise<void>;
}

export class MemoryTaskStore implements TaskStore {
  rows = new Map<string, StoredTask>();
  closed: string[] = [];
  next: NextCandidate | undefined;
  async saveTasks(drafts: TaskDraft[]) {
    return drafts.map(d => {
      const task: StoredTask = { ...structuredClone(d), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      this.rows.set(task.id, task);
      return structuredClone(task);
    });
  }
  async task(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : undefined; }
  async markApproved(id: string, at: string) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'open') return false;
    r.status = 'approved'; r.approvedAt = at; return true;
  }
  async reopen(id: string) { const r = this.rows.get(id); if (r?.status === 'approved') { r.status = 'open'; r.approvedAt = null; } }
  async markDone(id: string) { const r = this.rows.get(id); if (r) r.status = 'done'; }
  async nextCandidate() { return this.next; }
  async closeContact(contactId: string) { this.closed.push(contactId); }
}

/**
 * KNOWN LIMITATION: the `tasks` table has only (contact_id, kind, draft_body, due_at, status), so title, letter,
 * details, caseId and the draft text are persisted as JSON inside `draft_body`. approvedAt is implied by status
 * (approved/done) and not stored; createdAt is not stored (the read time is returned).
 */
interface Payload { title: string; caseId: string; letter?: TaskDraft['letter']; details?: TaskDraft['details']; text?: string }

export class PostgresTaskStore implements TaskStore {
  private get db() { return getDb(); }
  private toStored(row: typeof s.tasks.$inferSelect): StoredTask {
    const p = JSON.parse(row.draftBody ?? '{}') as Payload;
    return {
      id: row.id, createdAt: new Date().toISOString(), contactId: row.contactId, caseId: p.caseId, kind: row.kind, title: p.title,
      status: row.status, requiresApproval: true, approvedAt: null, draftBody: p.text, letter: p.letter, details: p.details,
    };
  }
  async saveTasks(drafts: TaskDraft[]) {
    if (!drafts.length) return [];
    const rows = await this.db.insert(s.tasks).values(drafts.map(d => ({
      contactId: d.contactId, kind: d.kind, status: 'open' as const,
      draftBody: JSON.stringify({ title: d.title, caseId: d.caseId, letter: d.letter, details: d.details, text: d.draftBody } satisfies Payload),
    }))).returning();
    return rows.map(r => this.toStored(r));
  }
  async task(id: string) {
    const [row] = await this.db.select().from(s.tasks).where(eq(s.tasks.id, id));
    return row ? this.toStored(row) : undefined;
  }
  async markApproved(id: string) {
    const rows = await this.db.update(s.tasks).set({ status: 'approved' }).where(and(eq(s.tasks.id, id), eq(s.tasks.status, 'open'))).returning({ id: s.tasks.id });
    return rows.length === 1;
  }
  async reopen(id: string) { await this.db.update(s.tasks).set({ status: 'open' }).where(and(eq(s.tasks.id, id), eq(s.tasks.status, 'approved'))); }
  async markDone(id: string) { await this.db.update(s.tasks).set({ status: 'done' }).where(eq(s.tasks.id, id)); }
  async nextCandidate(caseId: string) {
    const [row] = await this.db.select().from(s.caseCandidates).where(and(eq(s.caseCandidates.caseId, caseId), notExists(
      this.db.select({ one: sql`1` }).from(s.contacts).where(and(eq(s.contacts.caseId, caseId), eq(s.contacts.targetId, s.caseCandidates.targetId), eq(s.contacts.targetKind, s.caseCandidates.targetKind))),
    ))).orderBy(asc(sql`${s.caseCandidates.rank} NULLS LAST`)).limit(1);
    return row ? { id: row.id, targetKind: row.targetKind, targetId: row.targetId } : undefined;
  }
  async closeContact(contactId: string) { await this.db.update(s.contacts).set({ state: 'declined', lastActivityAt: new Date() }).where(eq(s.contacts.id, contactId)); }
}
