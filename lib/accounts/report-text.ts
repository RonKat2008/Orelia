/**
 * Lane K: turns the patient's embedded documents into one plain-text report for the intake extractor, so an uploaded
 * genetic report or clinic letter pre-fills the case and saves typing. Text is already sanitized at extraction; it is
 * sanitized again here and fenced by title. The extractor treats it as data to copy from, never instructions.
 */
import { REPORT_TEXT_MAX } from '@/lib/contracts';
import { sanitizeRecordText } from '@/lib/history/sanitize';
import { LIBRARY_DOC_TYPE_LABELS } from './contract';
import { getAccountStore, type AccountStore, type DocumentRow } from './store';

export interface DocumentReport { reportText: string; titles: string[] }

export function reportFromDocuments(docs: readonly Pick<DocumentRow, 'title' | 'docType' | 'text' | 'status'>[], max = REPORT_TEXT_MAX): DocumentReport {
  const parts: string[] = [];
  const titles: string[] = [];
  let used = 0;
  for (const d of docs) {
    if (d.status !== 'embedded' || !d.text) continue;
    const body = sanitizeRecordText(d.text.replace(/^\[Page \d+\]\n/gm, ''));
    if (!body) continue;
    const header = `--- ${LIBRARY_DOC_TYPE_LABELS[d.docType]}: ${d.title.replace(/[\r\n]+/g, ' ').slice(0, 120)} ---`;
    const room = max - used - header.length - 2;
    if (room < 200) break;
    const piece = `${header}\n${body.slice(0, room)}`;
    parts.push(piece);
    titles.push(d.title);
    used += piece.length + 2;
  }
  return { reportText: parts.join('\n\n'), titles };
}

/** Report text for the chosen documents of one scope (ids optional: all embedded documents). Foreign ids are ignored. */
export async function reportForScope(scopeId: string, ids?: readonly string[], store: AccountStore = getAccountStore()): Promise<DocumentReport> {
  const docs = (await store.listDocuments(scopeId)).filter(d => d.accountId === scopeId && (!ids || ids.includes(d.id)));
  return reportFromDocuments(docs.slice().reverse());
}
