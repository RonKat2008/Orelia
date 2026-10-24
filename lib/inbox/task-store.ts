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
  /** Optionally merges extra keys into the task's details (used to keep grounding evidence). */
  markDone(id: string, detailsPatch?: Record<string, unknown>): Promise<void>;
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
  async markDone(id: string, patch?: Record<string, unknown>) { const r = this.rows.get(id); if (r) { r.status = 'done'; if (patch) r.details = { ...r.details, ...patch }; } }
  async nextCandidate() { return this.next; }
  async closeContact(contactId: string) { this.closed.push(contactId); }
}

type TaskRow = typeof s.tasks.$inferSelect;
type Envelope = { letter?: TaskDraft['letter']; details?: TaskDraft['details'] };
interface LegacyPayload extends Envelope { title?: string; caseId?: string; text?: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Old rows kept everything as JSON in draft_body. Never throws; undefined if draft_body is not such JSON. */
function parseLegacy(body: string | null): LegacyPayload | undefined {
  if (!body) return undefined;
  try { const v: unknown = JSON.parse(body); return isObject(v) ? v as LegacyPayload : undefined; } catch { return undefined; }
}

/** Draft -> insert values for the real tasks columns. details holds the { letter, details } envelope. */
export function taskToRow(d: TaskDraft): typeof s.tasks.$inferInsert {
  return {
    contactId: d.contactId, caseId: d.caseId, kind: d.kind, title: d.title, status: 'open',
    draftBody: d.draftBody ?? null, details: { letter: d.letter ?? null, details: d.details ?? null }, approvedAt: null,
  };
}

/** Row -> StoredTask, preferring columns; falls back to legacy JSON in draft_body when title/details are null. */
export function rowToTask(row: TaskRow, now: () => string = () => new Date().toISOString()): StoredTask {
  const legacy = row.title == null || row.details == null ? parseLegacy(row.draftBody) : undefined;
  const env: Envelope = row.details
    ? { letter: (row.details.letter as TaskDraft['letter'] | null) ?? undefined, details: (row.details.details as TaskDraft['details'] | null) ?? undefined }
    : { letter: legacy?.letter, details: legacy?.details };
  return {
    id: row.id, createdAt: now(), contactId: row.contactId, caseId: row.caseId ?? legacy?.caseId ?? '', kind: row.kind,
    title: row.title ?? legacy?.title ?? '', status: row.status, requiresApproval: true,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    draftBody: legacy ? legacy.text : (row.draftBody ?? undefined),
    letter: env.letter, details: env.details,
  };
}

export class PostgresTaskStore implements TaskStore {
  private get db() { return getDb(); }
  async saveTasks(drafts: TaskDraft[]) {
    if (!drafts.length) return [];
    const rows = await this.db.insert(s.tasks).values(drafts.map(taskToRow)).returning();
    return rows.map(r => rowToTask(r));
  }
  async task(id: string) {
    const [row] = await this.db.select().from(s.tasks).where(eq(s.tasks.id, id));
    return row ? rowToTask(row) : undefined;
  }
  async markApproved(id: string, at: string) {
    const rows = await this.db.update(s.tasks).set({ status: 'approved', approvedAt: new Date(at) }).where(and(eq(s.tasks.id, id), eq(s.tasks.status, 'open'))).returning({ id: s.tasks.id });
    return rows.length === 1;
  }
  async reopen(id: string) { await this.db.update(s.tasks).set({ status: 'open', approvedAt: null }).where(and(eq(s.tasks.id, id), eq(s.tasks.status, 'approved'))); }
  async markDone(id: string, patch?: Record<string, unknown>) {
    if (!patch) { await this.db.update(s.tasks).set({ status: 'done' }).where(eq(s.tasks.id, id)); return; }
    const [row] = await this.db.select().from(s.tasks).where(eq(s.tasks.id, id));
    const env = (row?.details ?? {}) as Record<string, unknown>;
    const details = { ...env, details: { ...((env.details as Record<string, unknown> | null) ?? {}), ...patch } };
    await this.db.update(s.tasks).set({ status: 'done', details }).where(eq(s.tasks.id, id));
  }
  async nextCandidate(caseId: string) {
    const [row] = await this.db.select().from(s.caseCandidates).where(and(eq(s.caseCandidates.caseId, caseId), notExists(
      this.db.select({ one: sql`1` }).from(s.contacts).where(and(eq(s.contacts.caseId, caseId), eq(s.contacts.targetId, s.caseCandidates.targetId), eq(s.contacts.targetKind, s.caseCandidates.targetKind))),
    ))).orderBy(asc(sql`${s.caseCandidates.rank} NULLS LAST`)).limit(1);
    return row ? { id: row.id, targetKind: row.targetKind, targetId: row.targetId } : undefined;
  }
  async closeContact(contactId: string) { await this.db.update(s.contacts).set({ state: 'declined', lastActivityAt: new Date() }).where(eq(s.contacts.id, contactId)); }
}
