import { randomUUID } from 'node:crypto';
import { ingest, getDocumentStore } from '@/lib/case-docs';
import type { DocumentStore } from '@/lib/case-docs/store';
import {
  HISTORY_DOC_FIELD, MAX_DOCUMENTS_PER_CASE, MAX_RECORD_CHARS,
  type AddRecordBody, type HistoryDocument, type HistoryEvent, type HistoryStore, type HistoryTimeline,
} from './contract';
import { extractEvents, inferDocType } from './extract';
import { sanitizeRecordText } from './sanitize';
import { getHistoryStore } from './store';
import { vectorTitle } from './vector';
import { buildTimeline } from './timeline';

export type AddRecordDeps = { store?: HistoryStore; docs?: DocumentStore; llm?: boolean; now?: Date };

export class HistoryLimitError extends Error {
  constructor(readonly reason: 'too_many_documents' | 'empty_after_sanitize', message: string) { super(message); this.name = 'HistoryLimitError'; }
}

export async function loadTimeline(caseId: string, store: HistoryStore = getHistoryStore()): Promise<HistoryTimeline> {
  const [docs, events] = await Promise.all([store.listDocuments(caseId), store.listEvents(caseId)]);
  return buildTimeline(docs, events);
}

export async function addRecord(caseId: string, body: AddRecordBody, deps: AddRecordDeps = {}): Promise<{
  document: Omit<HistoryDocument, 'text'>; events: HistoryEvent[]; timeline: HistoryTimeline;
}> {
  const store = deps.store ?? getHistoryStore();
  if ((await store.listDocuments(caseId)).length >= MAX_DOCUMENTS_PER_CASE) {
    throw new HistoryLimitError('too_many_documents', `A case can hold at most ${MAX_DOCUMENTS_PER_CASE} records`);
  }
  const text = sanitizeRecordText(body.text).slice(0, MAX_RECORD_CHARS);
  if (!text.trim()) throw new HistoryLimitError('empty_after_sanitize', 'The record has no readable text');
  const doc: HistoryDocument = {
    id: randomUUID(), caseId, title: body.title, docType: body.docType ?? inferDocType(body.title, text),
    text, createdAt: (deps.now ?? new Date()).toISOString(), extractedBy: 'rules',
  };
  const extraction = await extractEvents(doc, { llm: deps.llm === true });
  const stored: HistoryDocument = { ...doc, extractedBy: extraction.extractedBy };
  await store.addDocument(stored, extraction.events);
  try {
    await ingest({ caseId, kind: 'medical_record', title: vectorTitle(stored), text, sharedField: HISTORY_DOC_FIELD }, deps.docs);
  } catch (err) {
    // Semantic search is an enhancement; the record and its timeline stand without it.
    console.error('[history] semantic indexing failed', err instanceof Error ? err.name : 'error');
  }
  const { text: _text, ...document } = stored;
  void _text;
  return { document, events: extraction.events, timeline: await loadTimeline(caseId, store) };
}

/** Removes a record, its events and its vector chunks. Returns false when the case has no such record. */
export async function removeRecord(caseId: string, docId: string, deps: Pick<AddRecordDeps, 'store' | 'docs'> = {}): Promise<boolean> {
  const store = deps.store ?? getHistoryStore();
  const doc = await store.getDocument(caseId, docId);
  if (!doc) return false;
  const removed = await store.deleteDocument(caseId, docId);
  if (removed) {
    try { await (deps.docs ?? getDocumentStore()).deleteByTitle?.(caseId, 'medical_record', vectorTitle(doc)); }
    catch (err) { console.error('[history] vector cleanup failed', err instanceof Error ? err.name : 'error'); }
  }
  return removed;
}
