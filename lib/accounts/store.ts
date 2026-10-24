/**
 * Accounts lane storage port: profiles, library documents and their per-account vector chunks.
 * Every read and write is scoped by accountId; an id from another account behaves exactly like a missing id.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { accountDocumentChunks, accountDocuments, accountProfiles } from '@/db/schema';
import type { DocStatus, LibraryDocType, LibraryDocument, Profile } from './contract';

export interface DocumentRow {
  id: string; accountId: string; title: string; docType: LibraryDocType; dateOfService: string | null;
  provider: string | null; notes: string | null; tags: string[]; fileName: string; contentType: string;
  sizeBytes: number; blobPathname: string; status: DocStatus; statusDetail: string | null; pageCount: number | null;
  chunkCount: number; text: string | null; createdAt: Date; updatedAt: Date;
}
export type NewDocumentRow = Omit<DocumentRow, 'createdAt' | 'updatedAt' | 'status' | 'statusDetail' | 'pageCount' | 'chunkCount' | 'text'>;
export type DocumentPatch = Partial<Pick<DocumentRow, 'title' | 'docType' | 'dateOfService' | 'provider' | 'notes' | 'tags'
  | 'status' | 'statusDetail' | 'pageCount' | 'chunkCount' | 'text'>>;

export interface ChunkRow {
  accountId: string; documentId: string; chunkIndex: number; page: number | null; section: string | null;
  content: string; embedding: number[]; embedModel: string;
}
export interface ChunkHit { documentId: string; chunkIndex: number; page: number | null; section: string | null; content: string; score: number }

export interface AccountStore {
  getProfile(accountId: string): Promise<Profile | null>;
  putProfile(accountId: string, profile: Profile): Promise<void>;
  createDocument(row: NewDocumentRow): Promise<DocumentRow>;
  getDocument(accountId: string, id: string): Promise<DocumentRow | undefined>;
  listDocuments(accountId: string): Promise<DocumentRow[]>;
  updateDocument(accountId: string, id: string, patch: DocumentPatch): Promise<DocumentRow | undefined>;
  deleteDocument(accountId: string, id: string): Promise<DocumentRow | undefined>;
  /** Atomically moves the document to 'extracting' unless another run holds it (extracting and touched within staleMs). */
  claimForProcessing(accountId: string, id: string, staleMs: number): Promise<DocumentRow | undefined>;
  replaceChunks(accountId: string, documentId: string, rows: ChunkRow[]): Promise<void>;
  searchChunks(accountId: string, embedding: number[], embedModel: string, k: number): Promise<ChunkHit[]>;
  countChunks(accountId: string): Promise<number>;
  /** Removes the profile, every document and every chunk of the account; returns the deleted documents. */
  deleteAccountData(accountId: string): Promise<DocumentRow[]>;
}

export function toLibraryDocument(row: DocumentRow): LibraryDocument {
  return {
    id: row.id, title: row.title, docType: row.docType, dateOfService: row.dateOfService, provider: row.provider,
    notes: row.notes, tags: [...row.tags], fileName: row.fileName, contentType: row.contentType, sizeBytes: row.sizeBytes,
    status: row.status, statusDetail: row.statusDetail, pageCount: row.pageCount, chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

const cosine = (a: number[], b: number[]) => {
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? a.reduce((s, n, i) => s + n * (b[i] ?? 0), 0) / norm : 0;
};

/** Process-local store for tests and offline runs. Returns deep copies. */
export class MemoryAccountStore implements AccountStore {
  private profiles = new Map<string, Profile>();
  private docs = new Map<string, DocumentRow>();
  private chunks: ChunkRow[] = [];

  async getProfile(accountId: string) { return structuredClone(this.profiles.get(accountId) ?? null); }
  async putProfile(accountId: string, profile: Profile) { this.profiles.set(accountId, structuredClone(profile)); }
  async createDocument(row: NewDocumentRow) {
    const now = new Date();
    const doc: DocumentRow = { ...structuredClone(row), id: row.id || randomUUID(), status: 'pending_upload', statusDetail: null,
      pageCount: null, chunkCount: 0, text: null, createdAt: now, updatedAt: now };
    this.docs.set(doc.id, doc);
    return structuredClone(doc);
  }
  async getDocument(accountId: string, id: string) {
    const doc = this.docs.get(id);
    return doc && doc.accountId === accountId ? structuredClone(doc) : undefined;
  }
  async listDocuments(accountId: string) {
    return [...this.docs.values()].filter(d => d.accountId === accountId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(d => structuredClone(d));
  }
  async updateDocument(accountId: string, id: string, patch: DocumentPatch) {
    const doc = this.docs.get(id);
    if (!doc || doc.accountId !== accountId) return undefined;
    const next = { ...doc, ...structuredClone(patch), updatedAt: new Date() };
    this.docs.set(id, next);
    return structuredClone(next);
  }
  async claimForProcessing(accountId: string, id: string, staleMs: number) {
    const doc = this.docs.get(id);
    if (!doc || doc.accountId !== accountId) return undefined;
    if (doc.status === 'extracting' && Date.now() - doc.updatedAt.getTime() < staleMs) return undefined;
    return this.updateDocument(accountId, id, { status: 'extracting', statusDetail: null });
  }
  async deleteDocument(accountId: string, id: string) {
    const doc = this.docs.get(id);
    if (!doc || doc.accountId !== accountId) return undefined;
    this.docs.delete(id);
    this.chunks = this.chunks.filter(c => c.documentId !== id);
    return structuredClone(doc);
  }
  async replaceChunks(accountId: string, documentId: string, rows: ChunkRow[]) {
    const doc = this.docs.get(documentId);
    if (!doc || doc.accountId !== accountId || rows.some(r => r.accountId !== accountId || r.documentId !== documentId)) {
      throw new Error('Chunk scope mismatch');
    }
    this.chunks = [...this.chunks.filter(c => c.documentId !== documentId), ...structuredClone(rows)];
  }
  async searchChunks(accountId: string, embedding: number[], embedModel: string, k: number) {
    return this.chunks.filter(c => c.accountId === accountId && c.embedModel === embedModel)
      .map(c => ({ documentId: c.documentId, chunkIndex: c.chunkIndex, page: c.page, section: c.section, content: c.content, score: cosine(c.embedding, embedding) }))
      .sort((a, b) => b.score - a.score).slice(0, k);
  }
  async countChunks(accountId: string) { return this.chunks.filter(c => c.accountId === accountId).length; }
  async deleteAccountData(accountId: string) {
    const docs = await this.listDocuments(accountId);
    for (const d of docs) this.docs.delete(d.id);
    this.chunks = this.chunks.filter(c => c.accountId !== accountId);
    this.profiles.delete(accountId);
    return docs;
  }
}

type DocSelect = typeof accountDocuments.$inferSelect;
const fromRow = (r: DocSelect): DocumentRow => ({
  id: r.id, accountId: r.accountId, title: r.title, docType: r.docType as LibraryDocType, dateOfService: r.dateOfService,
  provider: r.provider, notes: r.notes, tags: r.tags ?? [], fileName: r.fileName, contentType: r.contentType,
  sizeBytes: r.sizeBytes, blobPathname: r.blobPathname, status: r.status as DocStatus, statusDetail: r.statusDetail,
  pageCount: r.pageCount, chunkCount: r.chunkCount, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export class PostgresAccountStore implements AccountStore {
  private get db() { return getDb(); }
  async getProfile(accountId: string) {
    const [row] = await this.db.select({ profile: accountProfiles.profile }).from(accountProfiles)
      .where(eq(accountProfiles.accountId, accountId)).limit(1);
    return (row?.profile as Profile | undefined) ?? null;
  }
  async putProfile(accountId: string, profile: Profile) {
    await this.db.insert(accountProfiles).values({ accountId, profile })
      .onConflictDoUpdate({ target: accountProfiles.accountId, set: { profile, updatedAt: new Date() } });
  }
  async createDocument(row: NewDocumentRow) {
    const [created] = await this.db.insert(accountDocuments).values(row).returning();
    return fromRow(created);
  }
  async getDocument(accountId: string, id: string) {
    const [row] = await this.db.select().from(accountDocuments)
      .where(and(eq(accountDocuments.accountId, accountId), eq(accountDocuments.id, id))).limit(1);
    return row ? fromRow(row) : undefined;
  }
  async listDocuments(accountId: string) {
    return (await this.db.select().from(accountDocuments).where(eq(accountDocuments.accountId, accountId))
      .orderBy(desc(accountDocuments.createdAt))).map(fromRow);
  }
  async updateDocument(accountId: string, id: string, patch: DocumentPatch) {
    const [row] = await this.db.update(accountDocuments).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(accountDocuments.accountId, accountId), eq(accountDocuments.id, id))).returning();
    return row ? fromRow(row) : undefined;
  }
  async claimForProcessing(accountId: string, id: string, staleMs: number) {
    const t = accountDocuments;
    const cutoff = new Date(Date.now() - staleMs);
    const [row] = await this.db.update(t).set({ status: 'extracting', statusDetail: null, updatedAt: new Date() })
      .where(and(eq(t.accountId, accountId), eq(t.id, id), sql`(${t.status} <> 'extracting' OR ${t.updatedAt} < ${cutoff.toISOString()}::timestamptz)`))
      .returning();
    return row ? fromRow(row) : undefined;
  }
  async deleteDocument(accountId: string, id: string) {
    const [row] = await this.db.delete(accountDocuments)
      .where(and(eq(accountDocuments.accountId, accountId), eq(accountDocuments.id, id))).returning();
    return row ? fromRow(row) : undefined;
  }
  async replaceChunks(accountId: string, documentId: string, rows: ChunkRow[]) {
    if (rows.some(r => r.accountId !== accountId || r.documentId !== documentId)) throw new Error('Chunk scope mismatch');
    const t = accountDocumentChunks;
    await this.db.delete(t).where(and(eq(t.accountId, accountId), eq(t.documentId, documentId)));
    for (let i = 0; i < rows.length; i += 100) await this.db.insert(t).values(rows.slice(i, i + 100));
  }
  async searchChunks(accountId: string, embedding: number[], embedModel: string, k: number) {
    const t = accountDocumentChunks;
    const distance = cosineDistance(t.embedding, embedding);
    return this.db.select({
      documentId: t.documentId, chunkIndex: t.chunkIndex, page: t.page, section: t.section, content: t.content,
      score: sql<number>`1 - (${distance})`,
    }).from(t).where(and(eq(t.accountId, accountId), eq(t.embedModel, embedModel))).orderBy(asc(distance)).limit(k);
  }
  async countChunks(accountId: string) {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(accountDocumentChunks)
      .where(eq(accountDocumentChunks.accountId, accountId));
    return row?.n ?? 0;
  }
  async deleteAccountData(accountId: string) {
    const docs = (await this.db.delete(accountDocuments).where(eq(accountDocuments.accountId, accountId)).returning()).map(fromRow);
    await this.db.delete(accountDocumentChunks).where(eq(accountDocumentChunks.accountId, accountId));
    await this.db.delete(accountProfiles).where(eq(accountProfiles.accountId, accountId));
    return docs;
  }
}

const g = globalThis as { __wayfinderAccountStore?: AccountStore };
export function getAccountStore(): AccountStore {
  g.__wayfinderAccountStore ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresAccountStore() : new MemoryAccountStore();
  return g.__wayfinderAccountStore;
}
export function setAccountStoreForTests(store: AccountStore | undefined): void {
  if (store) g.__wayfinderAccountStore = store;
  else delete g.__wayfinderAccountStore;
}
