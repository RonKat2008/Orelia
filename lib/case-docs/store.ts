import { randomUUID } from 'node:crypto';
import { SHARED_FIELDS } from '@/lib/outreach/draft';
import type { DocumentKind } from '@/lib/contracts/case-docs';

export interface CaseDocument {
  id: string; caseId: string; contactId: string | null; kind: DocumentKind; title: string;
  sourceUrl: string | null; sharedField: string | null; chunkIndex: number; content: string;
  embedding: number[]; embedModel: string; createdAt: Date;
}
export type NewDocument = Omit<CaseDocument, 'id' | 'createdAt'>;
export interface SearchInput {
  caseId: string; contactId?: string; /** Only docs owned by contactId; excludes case-wide (contactId null) docs. */ contactOnly?: boolean; query: string; k?: number; allowedFields: readonly string[];
}
export type VectorSearch = SearchInput & { embedding: number[]; embedModel: string };
export type Snippet = Omit<CaseDocument, 'embedding'> & { score: number };
export type DocumentMetadata = Pick<CaseDocument, 'id' | 'kind' | 'title' | 'sharedField' | 'contactId' | 'createdAt'>;
export interface DocumentStore {
  insert(rows: NewDocument[]): Promise<CaseDocument[]>;
  search(input: VectorSearch): Promise<Snippet[]>;
  list(caseId: string): Promise<DocumentMetadata[]>;
  /** One document's text (chunks joined in order), scoped by case so another case's id returns undefined. */
  text(caseId: string, documentId: string): Promise<{ id: string; kind: DocumentKind; title: string; content: string } | undefined>;
}
export const PUBLIC_KINDS = ['resource_page', 'evidence'] as const;
export function consentFields(fields: readonly string[]) {
  return fields.filter(field => (SHARED_FIELDS as readonly string[]).includes(field));
}
export function resultLimit(k = 5) { return Number.isFinite(k) ? Math.max(1, Math.min(50, Math.trunc(k))) : 5; }
export function metadata(row: CaseDocument): DocumentMetadata {
  const { id, kind, title, sharedField, contactId, createdAt } = row;
  return { id, kind, title, sharedField, contactId, createdAt };
}
export class MemoryDocumentStore implements DocumentStore {
  private rows: CaseDocument[] = [];
  async insert(rows: NewDocument[]) {
    const inserted = rows.map(row => ({ ...structuredClone(row), id: randomUUID(), createdAt: new Date() }));
    this.rows.push(...inserted);
    return structuredClone(inserted);
  }
  async list(caseId: string) { return this.rows.filter(row => row.caseId === caseId).map(row => metadata(structuredClone(row))); }
  async text(caseId: string, documentId: string) {
    const row = this.rows.find(r => r.caseId === caseId && r.id === documentId);
    if (!row) return undefined;
    const same = this.rows.filter(r => r.caseId === caseId && r.title === row.title && r.kind === row.kind && r.contactId === row.contactId);
    return { id: row.id, kind: row.kind, title: row.title, content: same.sort((a, b) => a.chunkIndex - b.chunkIndex).map(r => r.content).join('\n') };
  }
  async search(input: VectorSearch) {
    const allowed = consentFields(input.allowedFields);
    return this.rows.filter(row => row.caseId === input.caseId && row.embedModel === input.embedModel
      && (row.contactId === input.contactId || (!input.contactOnly && row.contactId === null))
      && row.kind !== 'intake_report'
      && (row.sharedField === null ? (PUBLIC_KINDS as readonly string[]).includes(row.kind) : allowed.includes(row.sharedField)))
      .map(row => {
        const { embedding, ...rest } = structuredClone(row);
        const norm = Math.hypot(...embedding) * Math.hypot(...input.embedding);
        return { ...rest, score: norm ? embedding.reduce((sum, n, i) => sum + n * input.embedding[i], 0) / norm : 0 };
      }).sort((a, b) => b.score - a.score).slice(0, resultLimit(input.k));
  }
}
