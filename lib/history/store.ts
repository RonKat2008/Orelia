import { asc, and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { historyDocuments } from '@/db/schema';
import {
  historyDocumentSchema, historyEventSchema,
  type HistoryDocument, type HistoryEvent, type HistoryStore,
} from './contract';

function parseDoc(raw: unknown): HistoryDocument | null {
  const parsed = historyDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
function parseEvents(raw: unknown, docId?: string): HistoryEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const parsed = historyEventSchema.safeParse(item);
    return parsed.success && (docId === undefined || parsed.data.sourceDocId === docId) ? [parsed.data] : [];
  });
}
/** Validates a write; throws rather than storing anything malformed. */
function validate(doc: HistoryDocument, events: HistoryEvent[]): { doc: HistoryDocument; events: HistoryEvent[] } {
  const validDoc = parseDoc(doc);
  if (!validDoc) throw new Error('Invalid history document');
  const validEvents = parseEvents(events, validDoc.id);
  if (validEvents.length !== events.length) throw new Error('Invalid history event');
  return { doc: validDoc, events: validEvents };
}

/** Process-local store (dev/tests/offline). Keeps validated deep copies. */
export class MemoryHistoryStore implements HistoryStore {
  private readonly docs = new Map<string, { doc: HistoryDocument; events: HistoryEvent[] }>();

  async addDocument(doc: HistoryDocument, events: HistoryEvent[]): Promise<void> {
    const valid = validate(structuredClone(doc), structuredClone(events));
    this.docs.set(valid.doc.id, valid);
  }
  private forCase(caseId: string) {
    return [...this.docs.values()].filter(e => e.doc.caseId === caseId)
      .sort((a, b) => a.doc.createdAt.localeCompare(b.doc.createdAt));
  }
  async listDocuments(caseId: string): Promise<HistoryDocument[]> {
    return structuredClone(this.forCase(caseId).map(e => e.doc));
  }
  async listEvents(caseId: string): Promise<HistoryEvent[]> {
    return structuredClone(this.forCase(caseId).flatMap(e => e.events));
  }
  async getDocument(caseId: string, docId: string): Promise<HistoryDocument | undefined> {
    const entry = this.docs.get(docId);
    return entry && entry.doc.caseId === caseId ? structuredClone(entry.doc) : undefined;
  }
  async deleteDocument(caseId: string, docId: string): Promise<boolean> {
    const entry = this.docs.get(docId);
    if (!entry || entry.doc.caseId !== caseId) return false;
    return this.docs.delete(docId);
  }
}

export class PostgresHistoryStore implements HistoryStore {
  private get db() { return getDb(); }

  async addDocument(doc: HistoryDocument, events: HistoryEvent[]): Promise<void> {
    const valid = validate(doc, events);
    await this.db.insert(historyDocuments).values({
      id: valid.doc.id, caseId: valid.doc.caseId, title: valid.doc.title, docType: valid.doc.docType,
      text: valid.doc.text, extractedBy: valid.doc.extractedBy, events: valid.events,
      createdAt: new Date(valid.doc.createdAt),
    });
  }
  private async rows(caseId: string) {
    return this.db.select().from(historyDocuments).where(eq(historyDocuments.caseId, caseId)).orderBy(asc(historyDocuments.createdAt));
  }
  private toDoc(row: typeof historyDocuments.$inferSelect): HistoryDocument | null {
    return parseDoc({
      id: row.id, caseId: row.caseId, title: row.title, docType: row.docType, text: row.text,
      createdAt: row.createdAt.toISOString(), extractedBy: row.extractedBy,
    });
  }
  async listDocuments(caseId: string): Promise<HistoryDocument[]> {
    return (await this.rows(caseId)).flatMap(row => { const d = this.toDoc(row); return d ? [d] : []; });
  }
  async listEvents(caseId: string): Promise<HistoryEvent[]> {
    return (await this.rows(caseId)).flatMap(row => parseEvents(row.events, row.id));
  }
  async getDocument(caseId: string, docId: string): Promise<HistoryDocument | undefined> {
    const [row] = await this.db.select().from(historyDocuments)
      .where(and(eq(historyDocuments.caseId, caseId), eq(historyDocuments.id, docId))).limit(1);
    return row ? this.toDoc(row) ?? undefined : undefined;
  }
  async deleteDocument(caseId: string, docId: string): Promise<boolean> {
    const rows = await this.db.delete(historyDocuments)
      .where(and(eq(historyDocuments.caseId, caseId), eq(historyDocuments.id, docId))).returning({ id: historyDocuments.id });
    return rows.length === 1;
  }
}

const g = globalThis as unknown as { __wayfinderHistoryStore?: HistoryStore };

export function getHistoryStore(): HistoryStore {
  g.__wayfinderHistoryStore ??= process.env.DATABASE_URL && process.env.WAYFINDER_OFFLINE !== '1'
    ? new PostgresHistoryStore() : new MemoryHistoryStore();
  return g.__wayfinderHistoryStore;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setHistoryStoreForTests(store: HistoryStore | undefined): void {
  if (store) g.__wayfinderHistoryStore = store;
  else delete g.__wayfinderHistoryStore;
}
