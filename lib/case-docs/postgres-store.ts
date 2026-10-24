import { and, eq, or, isNull, inArray, sql, cosineDistance, asc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { caseDocuments } from '@/db/schema';
import { consentFields, resultLimit, type DocumentStore, type NewDocument, type VectorSearch } from './store';

export class PostgresDocumentStore implements DocumentStore {
  constructor(private db = getDb()) {}
  async insert(rows: NewDocument[]) {
    if (!rows.length) return [];
    return this.db.insert(caseDocuments).values(rows).returning();
  }
  async list(caseId: string) {
    const t = caseDocuments;
    return this.db.select({ id: t.id, kind: t.kind, title: t.title, sharedField: t.sharedField, contactId: t.contactId, createdAt: t.createdAt })
      .from(t).where(eq(t.caseId, caseId));
  }
  async search(input: VectorSearch) {
    const t = caseDocuments;
    const allowed = consentFields(input.allowedFields);
    const distance = cosineDistance(t.embedding, input.embedding);
    const rows = await this.db.select({
      id: t.id, caseId: t.caseId, contactId: t.contactId, kind: t.kind, title: t.title,
      sourceUrl: t.sourceUrl, sharedField: t.sharedField, chunkIndex: t.chunkIndex,
      content: t.content, embedModel: t.embedModel, createdAt: t.createdAt, score: sql<number>`1 - (${distance})`,
    }).from(t).where(and(
      eq(t.caseId, input.caseId), eq(t.embedModel, input.embedModel), sql`${t.kind} <> 'intake_report'`,
      input.contactId ? or(isNull(t.contactId), eq(t.contactId, input.contactId)) : isNull(t.contactId),
      or(and(isNull(t.sharedField), inArray(t.kind, ['resource_page', 'evidence'])),
        allowed.length ? inArray(t.sharedField, allowed) : sql`false`),
    )).orderBy(asc(distance)).limit(resultLimit(input.k));
    return rows;
  }
}
