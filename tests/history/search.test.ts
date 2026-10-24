import { beforeEach, describe, expect, it } from 'vitest';
import { ingest } from '@/lib/case-docs';
import { MemoryDocumentStore } from '@/lib/case-docs/store';
import { HISTORY_DOC_FIELD, type HistoryDocument, type HistoryEvent } from '@/lib/history/contract';
import { searchHistory, snippetAround, queryTerms } from '@/lib/history/search';
import { MemoryHistoryStore } from '@/lib/history/store';
import { vectorTitle } from '@/lib/history/vector';

const CASE = 'case-a';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const doc = (id: string, title: string, text: string): HistoryDocument =>
  ({ id, caseId: CASE, title, docType: 'other', text, createdAt: '2026-01-01T00:00:00.000Z', extractedBy: 'rules' });
const event = (id: string, docId: string, title: string, findings: string[]): HistoryEvent =>
  ({ id, date: '2024-05', kind: 'genetic_test', title, provider: null, institution: null, findings, sourceDocId: docId, span: { start: 0, end: 5 } });

let store: MemoryHistoryStore;
let docs: MemoryDocumentStore;
const T1 = 'Genetic report: COL3A1 c.2357G>A variant of uncertain significance reported. Follow-up advised.';
const T2 = 'Cardiology visit. Echocardiogram showed normal aortic root dimensions.';

async function seed(index = true) {
  store = new MemoryHistoryStore(); docs = new MemoryDocumentStore();
  const d1 = doc(D1, 'Genetics report', T1); const d2 = doc(D2, 'Cardiology note', T2);
  await store.addDocument(d1, [event('e1', D1, 'COL3A1 genetic test', ['COL3A1 c.2357G>A variant of uncertain significance'])]);
  await store.addDocument(d2, []);
  if (index) for (const d of [d1, d2]) await ingest({ caseId: CASE, kind: 'medical_record', title: vectorTitle(d), text: d.text, sharedField: HISTORY_DOC_FIELD }, docs);
}
beforeEach(() => seed());

describe('searchHistory', () => {
  it('keyword search is case-insensitive and finds event matches with a snippet', async () => {
    const hits = await searchHistory(CASE, 'col3a1', 10, { store, docs });
    const hit = hits.find(h => h.eventId === 'e1');
    expect(hit).toBeDefined();
    expect(hit!.sourceDocId).toBe(D1);
    expect(hit!.kind).toBe('genetic_test');
    expect(hit!.snippet.toLowerCase()).toContain('col3a1');
  });
  it('finds document text when no event matches, with eventId null', async () => {
    const hits = await searchHistory(CASE, 'echocardiogram', 10, { store, docs });
    const hit = hits.find(h => h.sourceDocId === D2);
    expect(hit?.eventId).toBeNull();
    expect(hit?.snippet.toLowerCase()).toContain('echocardiogram');
  });
  it('marks hits found by both methods as both, deduped, with scores in 0..1', async () => {
    const hits = await searchHistory(CASE, 'COL3A1 variant', 10, { store, docs });
    const forDoc1 = hits.filter(h => h.sourceDocId === D1);
    expect(forDoc1).toHaveLength(1);
    expect(forDoc1[0].match).toBe('both');
    for (const h of hits) { expect(h.score).toBeGreaterThanOrEqual(0); expect(h.score).toBeLessThanOrEqual(1); }
    expect(hits.map(h => h.score)).toEqual([...hits.map(h => h.score)].sort((a, b) => b - a));
  });
  it('degrades to keyword-only when the vector store has nothing', async () => {
    await seed(false);
    const hits = await searchHistory(CASE, 'COL3A1', 10, { store, docs });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.match === 'keyword')).toBe(true);
  });
  it('does not surface vector chunks of deleted records', async () => {
    await store.deleteDocument(CASE, D2);
    const hits = await searchHistory(CASE, 'echocardiogram aortic', 10, { store, docs });
    expect(hits.some(h => h.sourceDocId === D2)).toBe(false);
  });
  it('is scoped to the case and honours k', async () => {
    expect(await searchHistory('other-case', 'COL3A1', 10, { store, docs })).toEqual([]);
    expect((await searchHistory(CASE, 'visit COL3A1 aortic', 1, { store, docs })).length).toBe(1);
  });
  it('helpers: terms and snippets', () => {
    expect(queryTerms('A COL3A1, col3a1!')).toEqual(['col3a1']);
    expect(snippetAround('x'.repeat(300) + ' needle ' + 'y'.repeat(300), ['needle'])).toContain('needle');
  });
});
