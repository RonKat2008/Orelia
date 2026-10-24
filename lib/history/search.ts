import { search as semanticSearch } from '@/lib/case-docs';
import type { DocumentStore } from '@/lib/case-docs/store';
import { type HistoryEvent, type HistorySearchHit, type HistoryStore } from './contract';
import { docIdFromVectorTitle } from './vector';
import { getHistoryStore } from './store';

export const DEFAULT_SEARCH_K = 10;
const SNIPPET_RADIUS = 80;
const MAX_TERMS = 8;

export type SearchDeps = { store?: HistoryStore; docs?: DocumentStore };

export function queryTerms(q: string): string[] {
  const terms = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}
function matchedTerms(haystack: string, terms: string[]): string[] {
  const lower = haystack.toLowerCase();
  return terms.filter(t => lower.includes(t));
}
export function snippetAround(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = terms.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS * 2);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function keywordHits(terms: string[], docs: { id: string; title: string; text: string }[], events: HistoryEvent[]): HistorySearchHit[] {
  const titles = new Map(docs.map(d => [d.id, d.title]));
  const hits: HistorySearchHit[] = [];
  const docsWithEventHit = new Set<string>();
  for (const ev of events) {
    const field = [ev.title, ...ev.findings].join(' \n ');
    const matched = matchedTerms(field, terms);
    if (!matched.length || !titles.has(ev.sourceDocId)) continue;
    docsWithEventHit.add(ev.sourceDocId);
    hits.push({
      sourceDocId: ev.sourceDocId, docTitle: titles.get(ev.sourceDocId)!, eventId: ev.id, kind: ev.kind, date: ev.date,
      snippet: snippetAround(field, matched), score: clamp01(matched.length / terms.length), match: 'keyword',
    });
  }
  for (const doc of docs) {
    if (docsWithEventHit.has(doc.id)) continue;
    const matched = matchedTerms(doc.text, terms);
    if (!matched.length) continue;
    hits.push({
      sourceDocId: doc.id, docTitle: doc.title, eventId: null, kind: null, date: null,
      snippet: snippetAround(doc.text, matched), score: clamp01(matched.length / terms.length), match: 'keyword',
    });
  }
  return hits;
}

async function semanticHits(caseId: string, q: string, k: number, titles: Map<string, string>, docs?: DocumentStore): Promise<HistorySearchHit[]> {
  try {
    const rows = await semanticSearch({ caseId, query: q, k, allowedFields: [], includeMedicalRecords: true }, docs);
    return rows.flatMap(row => {
      const id = docIdFromVectorTitle(row.title);
      if (row.kind !== 'medical_record' || !id || !titles.has(id)) return [];
      return [{
        sourceDocId: id, docTitle: titles.get(id)!, eventId: null, kind: null, date: null,
        snippet: snippetAround(row.content, []), score: clamp01(row.score), match: 'semantic' as const,
      }];
    });
  } catch (err) {
    console.error('[history] semantic search unavailable', err instanceof Error ? err.name : 'error');
    return [];
  }
}

export async function searchHistory(caseId: string, q: string, k = DEFAULT_SEARCH_K, deps: SearchDeps = {}): Promise<HistorySearchHit[]> {
  const limit = Math.max(1, Math.min(50, Math.trunc(k) || DEFAULT_SEARCH_K));
  const store = deps.store ?? getHistoryStore();
  const [docs, events] = await Promise.all([store.listDocuments(caseId), store.listEvents(caseId)]);
  if (!docs.length) return [];
  const terms = queryTerms(q);
  const keyword = terms.length ? keywordHits(terms, docs, events) : [];
  const semantic = await semanticHits(caseId, q, limit, new Map(docs.map(d => [d.id, d.title])), deps.docs);

  const merged = keyword.map(h => ({ ...h }));
  for (const sem of semantic) {
    const same = merged.filter(h => h.sourceDocId === sem.sourceDocId && h.match !== 'semantic');
    const best = same.sort((a, b) => b.score - a.score)[0];
    if (best) {
      best.match = 'both';
      best.score = Math.max(best.score, sem.score);
    } else if (!merged.some(h => h.sourceDocId === sem.sourceDocId && h.match === 'semantic')) {
      merged.push(sem);
    }
  }
  return merged.sort((a, b) => b.score - a.score || a.docTitle.localeCompare(b.docTitle)).slice(0, limit);
}
