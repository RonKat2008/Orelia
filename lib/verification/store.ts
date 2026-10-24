/** Verification request persistence: port, in-memory implementation (tests / offline) and Postgres. */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { verificationRequestSchema, type VerificationRequest, type VerificationStatus } from './contract';
import type { VerificationEvidence } from './evidence';

export type VerificationPatch = Partial<Pick<VerificationRequest, 'status' | 'callId' | 'result' | 'evidenceIds' | 'blockedReasons'>>;

export interface VerificationStore {
  create(request: VerificationRequest): Promise<VerificationRequest>;
  get(caseId: string, id: string): Promise<VerificationRequest | null>;
  list(caseId: string): Promise<VerificationRequest[]>;
  byCallId(callId: string): Promise<VerificationRequest | null>;
  /** Compare-and-set: only an awaiting_approval request with approvedAt null is approved; null otherwise. */
  approve(caseId: string, id: string, approvedAt: string): Promise<VerificationRequest | null>;
  /** Compare-and-set on the current status; null when the status changed meanwhile. */
  update(id: string, expected: VerificationStatus, patch: VerificationPatch): Promise<VerificationRequest | null>;
  /** Optional: also write the rows into the case `evidence` table (Postgres). */
  saveEvidence?(request: VerificationRequest, rows: readonly VerificationEvidence[]): Promise<void>;
}

const valid = (r: unknown): VerificationRequest | null => {
  const parsed = verificationRequestSchema.safeParse(r);
  return parsed.success ? parsed.data : null;
};

/** Process-local store. Keeps validated deep copies so callers cannot mutate stored state. */
export class MemoryVerificationStore implements VerificationStore {
  private readonly rows = new Map<string, VerificationRequest>();
  readonly evidence: VerificationEvidence[] = [];

  async create(request: VerificationRequest) {
    const v = verificationRequestSchema.parse(request);
    if (this.rows.has(v.id)) throw new Error('duplicate verification request id');
    this.rows.set(v.id, structuredClone(v));
    return structuredClone(v);
  }
  async get(caseId: string, id: string) {
    const r = this.rows.get(id);
    return r && r.caseId === caseId ? structuredClone(r) : null;
  }
  async list(caseId: string) {
    return [...this.rows.values()].filter(r => r.caseId === caseId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => structuredClone(r));
  }
  async byCallId(callId: string) {
    const r = [...this.rows.values()].find(x => x.callId === callId);
    return r ? structuredClone(r) : null;
  }
  async approve(caseId: string, id: string, approvedAt: string) {
    const r = this.rows.get(id);
    if (!r || r.caseId !== caseId || r.approvedAt !== null || r.status !== 'awaiting_approval') return null;
    const next = verificationRequestSchema.parse({ ...r, approvedAt });
    this.rows.set(id, next);
    return structuredClone(next);
  }
  async update(id: string, expected: VerificationStatus, patch: VerificationPatch) {
    const r = this.rows.get(id);
    if (!r || r.status !== expected) return null;
    if (patch.callId && [...this.rows.values()].some(x => x.id !== id && x.callId === patch.callId)) return null;
    const next = verificationRequestSchema.parse({ ...r, ...structuredClone(patch) });
    this.rows.set(id, next);
    return structuredClone(next);
  }
  async saveEvidence(_request: VerificationRequest, rows: readonly VerificationEvidence[]) {
    for (const row of rows) if (!this.evidence.some(e => e.id === row.id)) this.evidence.push(structuredClone(row));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresVerificationStore implements VerificationStore {
  private async ctx() {
    const [{ getDb }, s] = await Promise.all([import('@/db/client'), import('@/db/schema')]);
    return { db: getDb(), t: s.verificationRequests, evidence: s.evidence };
  }

  private toRequest(row: Record<string, unknown>): VerificationRequest | null {
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
    return valid({ ...row, createdAt: iso(row.createdAt), approvedAt: iso(row.approvedAt), callId: row.callId ?? null, result: row.result ?? null });
  }

  private values(r: VerificationRequest) {
    return {
      id: r.id, caseId: r.caseId, resourceKey: r.resourceKey, targetKind: r.targetKind, targetId: r.targetId, name: r.name,
      phone: r.phone, phoneEvidenceId: r.phoneEvidenceId, sharedFields: [...r.sharedFields], script: r.script, status: r.status,
      createdAt: new Date(r.createdAt), approvedAt: r.approvedAt ? new Date(r.approvedAt) : null, callId: r.callId,
      result: r.result as unknown as Record<string, unknown> | null, evidenceIds: r.evidenceIds, blockedReasons: r.blockedReasons,
    };
  }

  async create(request: VerificationRequest) {
    const v = verificationRequestSchema.parse(request);
    const { db, t } = await this.ctx();
    const [row] = await db.insert(t).values(this.values(v)).returning();
    return this.toRequest(row) ?? v;
  }
  async get(caseId: string, id: string) {
    if (!UUID.test(id)) return null;
    const { db, t } = await this.ctx();
    const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.caseId, caseId))).limit(1);
    return row ? this.toRequest(row) : null;
  }
  async list(caseId: string) {
    const { db, t } = await this.ctx();
    const rows = await db.select().from(t).where(eq(t.caseId, caseId)).orderBy(desc(t.createdAt));
    return rows.map(r => this.toRequest(r)).filter((r): r is VerificationRequest => r !== null);
  }
  async byCallId(callId: string) {
    const { db, t } = await this.ctx();
    const [row] = await db.select().from(t).where(eq(t.callId, callId)).limit(1);
    return row ? this.toRequest(row) : null;
  }
  async approve(caseId: string, id: string, approvedAt: string) {
    if (!UUID.test(id)) return null;
    const { db, t } = await this.ctx();
    const [row] = await db.update(t).set({ approvedAt: new Date(approvedAt) })
      .where(and(eq(t.id, id), eq(t.caseId, caseId), eq(t.status, 'awaiting_approval'), isNull(t.approvedAt))).returning();
    return row ? this.toRequest(row) : null;
  }
  async update(id: string, expected: VerificationStatus, patch: VerificationPatch) {
    const { db, t } = await this.ctx();
    const set = {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.callId !== undefined ? { callId: patch.callId } : {}),
      ...(patch.result !== undefined ? { result: patch.result as unknown as Record<string, unknown> | null } : {}),
      ...(patch.evidenceIds !== undefined ? { evidenceIds: patch.evidenceIds } : {}),
      ...(patch.blockedReasons !== undefined ? { blockedReasons: patch.blockedReasons } : {}),
    };
    const [row] = await db.update(t).set(set).where(and(eq(t.id, id), eq(t.status, expected))).returning();
    return row ? this.toRequest(row) : null;
  }
  /** Rows go into the case-scoped evidence table when the target id is a uuid (Postgres resources); idempotent. */
  async saveEvidence(request: VerificationRequest, rows: readonly VerificationEvidence[]) {
    if (!rows.length || !UUID.test(request.targetId)) return;
    const { db, evidence } = await this.ctx();
    await db.insert(evidence).values(rows.map(r => ({
      id: r.id, caseId: request.caseId, targetKind: request.targetKind, targetId: request.targetId,
      claimType: r.claimType, claim: r.claim, sourceUrl: r.sourceUrl, sourceKind: r.sourceKind, fetchedAt: new Date(r.fetchedAt),
    }))).onConflictDoNothing();
  }
}

const g = globalThis as unknown as { __wayfinderVerificationStore?: VerificationStore };

export function getVerificationStore(): VerificationStore {
  g.__wayfinderVerificationStore ??= process.env.DATABASE_URL ? new PostgresVerificationStore() : new MemoryVerificationStore();
  return g.__wayfinderVerificationStore;
}

export function setVerificationStoreForTests(store: VerificationStore | undefined): void {
  if (store) g.__wayfinderVerificationStore = store;
  else delete g.__wayfinderVerificationStore;
}
