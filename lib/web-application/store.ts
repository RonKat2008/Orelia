import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tasks, webApplications } from '@/db/schema';
import type { ApplicationStatus, FilledField, MissingField, WebApplicationDraft } from './types';

/** Persistence for web_application drafts. approve/claim are compare-and-set so a double click cannot submit twice. */
export interface ApplicationStore {
  save(draft: WebApplicationDraft): Promise<WebApplicationDraft>;
  get(id: string): Promise<WebApplicationDraft | undefined>;
  listByCase(caseId: string): Promise<WebApplicationDraft[]>;
  /** draft -> approved with the ticked fields/documents. False if the draft was not in 'draft'. */
  approve(id: string, input: { approvedAt: string; sharedFields: string[]; sharedDocIds: string[] }): Promise<boolean>;
  /** approved -> submitting claim; 'submitted' is stored only after success. False if not currently approved. */
  claimSubmit(id: string): Promise<boolean>;
  finish(id: string, status: Extract<ApplicationStatus, 'submitted' | 'stale' | 'refused' | 'failed'>, result: Record<string, unknown>, at: string): Promise<void>;
  /** Review-application task in the tracker/outbox; created when a draft is saved. */
  createReviewTask(draft: WebApplicationDraft): Promise<string | null>;
}

export class MemoryApplicationStore implements ApplicationStore {
  readonly rows = new Map<string, WebApplicationDraft>();
  readonly reviewTasks: { applicationId: string; caseId: string; title: string }[] = [];
  async save(draft: WebApplicationDraft) { this.rows.set(draft.id, structuredClone(draft)); return structuredClone(draft); }
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : undefined; }
  async listByCase(caseId: string) { return [...this.rows.values()].filter(r => r.caseId === caseId).map(r => structuredClone(r)); }
  async approve(id: string, input: { approvedAt: string; sharedFields: string[]; sharedDocIds: string[] }) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'draft') return false;
    this.rows.set(id, { ...row, status: 'approved', approvedAt: input.approvedAt, sharedFields: [...input.sharedFields], sharedDocIds: [...input.sharedDocIds] });
    return true;
  }
  async claimSubmit(id: string) {
    const row = this.rows.get(id);
    if (!row || row.status !== 'approved') return false;
    this.rows.set(id, { ...row, status: 'submitting' }); // never retried automatically; finish() settles it
    return true;
  }
  async finish(id: string, status: ApplicationStatus, result: Record<string, unknown>, at: string) {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, status, result, submittedAt: status === 'submitted' ? at : row.submittedAt });
  }
  async createReviewTask(draft: WebApplicationDraft) {
    this.reviewTasks.push({ applicationId: draft.id, caseId: draft.caseId, title: titleFor(draft) });
    return draft.id;
  }
}

const titleFor = (draft: WebApplicationDraft) => `Review application at ${new URL(draft.url).host}`;

type Row = typeof webApplications.$inferSelect;
function toDraft(row: Row): WebApplicationDraft {
  return {
    id: row.id, caseId: row.caseId, contactId: row.contactId, url: row.url,
    fields: row.fields as FilledField[], missing: row.missing as MissingField[],
    formFingerprint: row.formFingerprint, screenshot: row.screenshot,
    sharedFields: row.sharedFields, sharedDocIds: row.sharedDocIds,
    status: row.status as ApplicationStatus,
    approvedAt: row.approvedAt?.toISOString() ?? null, submittedAt: row.submittedAt?.toISOString() ?? null,
    result: row.result ?? null, createdAt: row.createdAt.toISOString(),
  };
}

export class PostgresApplicationStore implements ApplicationStore {
  constructor(private db = getDb()) {}
  async save(draft: WebApplicationDraft) {
    const [row] = await this.db.insert(webApplications).values({
      id: draft.id, caseId: draft.caseId, contactId: draft.contactId, url: draft.url, fields: draft.fields, missing: draft.missing,
      formFingerprint: draft.formFingerprint, screenshot: draft.screenshot, sharedFields: draft.sharedFields,
      sharedDocIds: draft.sharedDocIds, status: draft.status,
    }).returning();
    return toDraft(row);
  }
  async get(id: string) {
    const [row] = await this.db.select().from(webApplications).where(eq(webApplications.id, id)).limit(1);
    return row ? toDraft(row) : undefined;
  }
  async listByCase(caseId: string) {
    return (await this.db.select().from(webApplications).where(eq(webApplications.caseId, caseId)).orderBy(desc(webApplications.createdAt))).map(toDraft);
  }
  async approve(id: string, input: { approvedAt: string; sharedFields: string[]; sharedDocIds: string[] }) {
    const rows = await this.db.update(webApplications).set({
      status: 'approved', approvedAt: new Date(input.approvedAt), sharedFields: input.sharedFields, sharedDocIds: input.sharedDocIds,
    }).where(and(eq(webApplications.id, id), eq(webApplications.status, 'draft'))).returning({ id: webApplications.id });
    return rows.length === 1;
  }
  async claimSubmit(id: string) {
    const rows = await this.db.update(webApplications).set({ status: 'submitting' })
      .where(and(eq(webApplications.id, id), eq(webApplications.status, 'approved'))).returning({ id: webApplications.id });
    return rows.length === 1;
  }
  async finish(id: string, status: ApplicationStatus, result: Record<string, unknown>, at: string) {
    await this.db.update(webApplications).set({ status, result, ...(status === 'submitted' ? { submittedAt: new Date(at) } : {}) })
      .where(eq(webApplications.id, id));
  }
  async createReviewTask(draft: WebApplicationDraft) {
    if (!draft.contactId) return null; // tasks.contact_id is NOT NULL; unlinked drafts are reviewed from the application list
    const [row] = await this.db.insert(tasks).values({
      contactId: draft.contactId, caseId: draft.caseId, kind: 'application', status: 'open',
      title: titleFor(draft), details: { applicationId: draft.id, url: draft.url, missingCount: draft.missing.length },
    }).returning({ id: tasks.id });
    await this.db.update(webApplications).set({ taskId: row.id }).where(eq(webApplications.id, draft.id));
    return row.id;
  }
}

const state = globalThis as unknown as { __wayfinderApplications?: ApplicationStore };
export function getApplicationStore(): ApplicationStore {
  return state.__wayfinderApplications ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresApplicationStore() : new MemoryApplicationStore();
}
