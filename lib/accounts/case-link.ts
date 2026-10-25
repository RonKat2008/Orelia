/**
 * Bridges the account library into a case: the account that owns a case is the library its agents read from.
 * Importing copies embedded library documents into the case's medical history (lib/history), so the timeline,
 * conflicts and coordinate packets cite them by title exactly like records added on the case page.
 */
import { addRecord, HistoryLimitError, loadTimeline } from '@/lib/history/ingest';
import { getHistoryStore } from '@/lib/history/store';
import type { DocType, HistoryStore, HistoryTimeline } from '@/lib/history/contract';
import { getOwnerStore, type OwnerStore } from '@/lib/auth/ownership';
import type { LibraryDocType, MedicalHistoryHit } from './contract';
import { searchMedicalHistory, type RetrieveDeps } from './retrieve';
import { scopeForCase } from './scope';
import { getAccountStore, type AccountStore } from './store';

const DOC_TYPE_MAP: Record<LibraryDocType, DocType> = {
  lab: 'lab_report', imaging: 'imaging_report', clinic_note: 'visit_note', discharge_summary: 'discharge_summary',
  genetic_test: 'genetic_report', pathology: 'lab_report', letter: 'letter', insurance: 'other', other: 'other',
};

/** History titles carry the date of service so the timeline can order and cite records. */
export function historyTitleFor(doc: { title: string; dateOfService: string | null }): string {
  return (doc.dateOfService ? `${doc.title} (${doc.dateOfService})` : doc.title).slice(0, 200);
}

export async function caseAccountId(caseId: string, owners: OwnerStore = getOwnerStore()): Promise<string | null> {
  return (await owners.accountOf?.(caseId)) ?? null;
}

export interface ImportDeps { store?: AccountStore; history?: HistoryStore; llm?: boolean }

export async function importLibraryIntoCase(caseId: string, accountId: string, deps: ImportDeps = {}): Promise<{
  imported: number; skipped: number; timeline: HistoryTimeline;
}> {
  const store = deps.store ?? getAccountStore();
  const history = deps.history ?? getHistoryStore();
  // Dedup by the library document id: two documents may share a title and date, and titles can be edited.
  const existing = new Set((await history.listDocuments(caseId)).flatMap(d => d.sourceDocumentId ? [d.sourceDocumentId] : []));
  const docs = (await store.listDocuments(accountId)).filter(d => d.accountId === accountId && d.status === 'embedded' && d.text);
  let imported = 0;
  let skipped = 0;
  for (const doc of docs.slice().reverse()) {
    if (existing.has(doc.id)) { skipped++; continue; }
    try {
      await addRecord(caseId, { title: historyTitleFor(doc), text: doc.text!, docType: DOC_TYPE_MAP[doc.docType] }, {
        store: history, llm: deps.llm, sourceDocumentId: doc.id,
      });
      existing.add(doc.id);
      imported++;
    } catch (err) {
      if (err instanceof HistoryLimitError) { skipped++; continue; }
      throw err;
    }
  }
  return { imported, skipped, timeline: await loadTimeline(caseId, history) };
}

/** Retrieval for a case: only the library of the account that owns the case (never the viewer's, never another's). */
export async function searchCaseLibrary(caseId: string, query: string, k = 5, deps: RetrieveDeps & { owners?: OwnerStore } = {}): Promise<{
  available: boolean; results: MedicalHistoryHit[];
}> {
  // Lane K: anonymous cases have their own document space (`case:<id>`); account cases read the account library.
  const results = await searchMedicalHistory(await scopeForCase(caseId, deps.owners), query, k, deps);
  return { available: true, results };
}

/**
 * When a library document is deleted, its copies in the account's case histories go too (timeline + vectors).
 * Copies are matched by source document id only, so same-title documents and renamed documents behave correctly and
 * records the patient added on the case page are never touched. Call this BEFORE deleting the library row: the
 * history_documents FK cascades, which would otherwise remove the rows without their vector chunks.
 */
export async function removeFromCases(accountId: string, doc: { id: string }, deps: {
  owners?: OwnerStore; history?: HistoryStore;
} = {}): Promise<number> {
  const { removeRecord } = await import('@/lib/history/ingest');
  const history = deps.history ?? getHistoryStore();
  const caseIds = (await (deps.owners ?? getOwnerStore()).casesForAccount?.(accountId)) ?? [];
  let removed = 0;
  for (const caseId of caseIds) {
    for (const h of await history.listDocuments(caseId)) {
      if (h.sourceDocumentId === doc.id && await removeRecord(caseId, h.id, { store: history })) removed++;
    }
  }
  return removed;
}
