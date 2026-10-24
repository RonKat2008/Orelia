/**
 * Where a specialist packet reads the patient's history from.
 *
 * The medical-history lane (lib/history) is built in parallel and is not on main yet. Until it lands, packets read the
 * per-case document store (the patient's own uploaded records, notes and intake summary). When lib/history exists, it
 * calls `registerHistorySource(...)` (see HISTORY_LANE_HOOK below) and every packet build uses it instead.
 */
import { getDocumentStore, type DocumentStore } from '@/lib/case-docs';
import type { DocumentKind } from '@/lib/contracts/case-docs';
import { neutralizeUntrusted } from '@/lib/agents/research/untrusted';

export type HistorySourceName = 'history' | 'case_docs' | 'fixture';

export interface HistoryDocument {
  /** Stable id of the patient's own record (case_documents id for the case-docs source). */
  id: string;
  title: string;
  /** Raw text; callers must treat it as data. Line structure is preserved (sanitize per line, not per blob). */
  text: string;
}

export interface HistorySource {
  readonly name: HistorySourceName;
  load(caseId: string): Promise<HistoryDocument[]>;
}

/** The patient's own records only; public resource pages, evidence and third-party messages are not "history". */
export const HISTORY_KINDS: readonly DocumentKind[] = ['case_summary', 'intake_report', 'patient_note'];

const MAX_DOCS = 40;

/** Case documents (lib/case-docs) as a history source. list() is chunk-level, so documents are de-duplicated by id/title. */
export function caseDocsHistorySource(store: () => DocumentStore = getDocumentStore): HistorySource {
  return {
    name: 'case_docs',
    async load(caseId) {
      const s = store();
      const metas = await s.list(caseId);
      const seen = new Set<string>();
      const out: HistoryDocument[] = [];
      for (const m of metas) {
        if (!HISTORY_KINDS.includes(m.kind)) continue;
        const key = `${m.kind}\u0000${m.title}\u0000${m.contactId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (out.length >= MAX_DOCS) break;
        const doc = await s.text(caseId, m.id);
        if (!doc) continue;
        out.push({ id: doc.id, title: neutralizeUntrusted(doc.title).slice(0, 120) || doc.kind, text: doc.content });
      }
      // case_summary first so the summary section prefers it
      return out.sort((a, b) => rank(a, metas) - rank(b, metas));
    },
  };
}

function rank(doc: HistoryDocument, metas: { id: string; kind: DocumentKind }[]): number {
  const kind = metas.find(m => m.id === doc.id)?.kind;
  return kind === 'case_summary' ? 0 : kind === 'intake_report' ? 1 : 2;
}

/**
 * HOOK FOR lib/history: the history lane calls this once at module load (or a wiring file does) to make packets read
 * from the structured medical history instead of raw case documents. Pass undefined to restore the case-docs source.
 */
const holder = globalThis as unknown as { __wayfinderHistorySource?: HistorySource };
export function registerHistorySource(source: HistorySource | undefined): void {
  if (source) holder.__wayfinderHistorySource = source;
  else delete holder.__wayfinderHistorySource;
}
export function getHistorySource(): HistorySource {
  return holder.__wayfinderHistorySource ?? caseDocsHistorySource();
}
