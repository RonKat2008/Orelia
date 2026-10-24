import { and, eq, or, isNull, inArray, sql, cosineDistance, asc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { caseDocuments } from '@/db/schema';
import type { DocumentKind } from '@/lib/contracts/case-docs';
import { resultLimit, searchFields, type DocumentStore, type NewDocument, type VectorSearch } from './store';

export class PostgresDocumentStore implements DocumentStore {
  constructor(private db = getDb()) {}
  async insert(rows: NewDocument[]) {
    if (!rows.length) return [];
    return this.db.insert(caseDocuments).values(rows).returning();
  }
  async deleteByTitle(caseId: string, kind: DocumentKind, title: string) {
    const t = caseDocuments;
    const rows = await this.db.delete(t).where(and(eq(t.caseId, caseId), eq(t.kind, kind), eq(t.title, title))).returning({ id: t.id });
    return rows.length;
  }
  async list(caseId: string) {
    const t = caseDocuments;
    return this.db.select({ id: t.id, kind: t.kind, title: t.title, sharedField: t.sharedField, contactId: t.contactId, createdAt: t.createdAt })
      .from(t).where(eq(t.caseId, caseId));
  }
  async text(caseId: string, documentId: string) {
    const t = caseDocuments;
    const [row] = await this.db.select({ id: t.id, kind: t.kind, title: t.title, contactId: t.contactId }).from(t)
      .where(and(eq(t.caseId, caseId), eq(t.id, documentId))).limit(1);
    if (!row) return undefined;
    const chunks = await this.db.select({ content: t.content }).from(t).where(and(
      eq(t.caseId, caseId), eq(t.kind, row.kind), eq(t.title, row.title),
      row.contactId ? eq(t.contactId, row.contactId) : isNull(t.contactId),
    )).orderBy(asc(t.chunkIndex));
    return { id: row.id, kind: row.kind, title: row.title, content: chunks.map(c => c.content).join('\n') };
  }
  async search(input: VectorSearch) {
    const t = caseDocuments;
    const allowed = searchFields(input);
    const distance = cosineDistance(t.embedding, input.embedding);
    const rows = await this.db.select({
      id: t.id, caseId: t.caseId, contactId: t.contactId, kind: t.kind, title: t.title,
      sourceUrl: t.sourceUrl, sharedField: t.sharedField, chunkIndex: t.chunkIndex,
      content: t.content, embedModel: t.embedModel, createdAt: t.createdAt, score: sql<number>`1 - (${distance})`,
    }).from(t).where(and(
      eq(t.caseId, input.caseId), eq(t.embedModel, input.embedModel), sql`${t.kind} <> 'intake_report'`,
      input.includeMedicalRecords === true ? sql`true` : sql`${t.kind} <> 'medical_record'`,
      input.contactId ? (input.contactOnly ? eq(t.contactId, input.contactId) : or(isNull(t.contactId), eq(t.contactId, input.contactId))) : isNull(t.contactId),
      or(and(isNull(t.sharedField), inArray(t.kind, ['resource_page', 'evidence'])),
        allowed.length ? inArray(t.sharedField, allowed) : sql`false`),
    )).orderBy(asc(distance)).limit(resultLimit(input.k));
    return rows;
  }
}
