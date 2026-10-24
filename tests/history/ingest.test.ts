import { describe, expect, it } from 'vitest';
import { MemoryDocumentStore } from '@/lib/case-docs/store';
import { MAX_DOCUMENTS_PER_CASE } from '@/lib/history/contract';
import { addRecord, HistoryLimitError, loadTimeline, removeRecord } from '@/lib/history/ingest';
import { searchHistory } from '@/lib/history/search';
import { MemoryHistoryStore } from '@/lib/history/store';

const CASE = 'case-a';
const TEXT = 'Genetics clinic visit 2024-03-12. Dr. Rivera reviewed results. COL3A1 c.2357G>A variant of uncertain significance.';
const fresh = () => ({ store: new MemoryHistoryStore(), docs: new MemoryDocumentStore() });

describe('addRecord', () => {
  it('stores the document, extracts events, indexes vector chunks and returns the timeline', async () => {
    const deps = fresh();
    const res = await addRecord(CASE, { title: 'Genetics note', text: TEXT }, deps);
    expect(res.document).not.toHaveProperty('text');
    expect(res.document.title).toBe('Genetics note');
    expect(res.timeline.documents.map(d => d.id)).toEqual([res.document.id]);
    expect(res.timeline.events.map(e => e.id).sort()).toEqual(res.events.map(e => e.id).sort());
    for (const e of res.events) expect(e.sourceDocId).toBe(res.document.id);
    const chunks = await deps.docs.list(CASE);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.kind === 'medical_record' && c.sharedField === 'medicalHistory')).toBe(true);
    expect((await searchHistory(CASE, 'COL3A1', 5, deps)).length).toBeGreaterThan(0);
  });
  it('honours an explicit docType and enforces the per-case limit', async () => {
    const deps = fresh();
    const res = await addRecord(CASE, { title: 'T', text: TEXT, docType: 'letter' }, deps);
    expect(res.document.docType).toBe('letter');
    for (let i = 1; i < MAX_DOCUMENTS_PER_CASE; i++) await addRecord(CASE, { title: `T${i}`, text: TEXT }, deps);
    await expect(addRecord(CASE, { title: 'one more', text: TEXT }, deps)).rejects.toBeInstanceOf(HistoryLimitError);
    expect((await loadTimeline(CASE, deps.store)).documents).toHaveLength(MAX_DOCUMENTS_PER_CASE);
  }, 60_000);
  it('keeps the record when vector indexing fails', async () => {
    const deps = fresh();
    const broken = { ...deps.docs, insert: async () => { throw new Error('embed down'); } } as unknown as MemoryDocumentStore;
    const res = await addRecord(CASE, { title: 'T', text: TEXT }, { store: deps.store, docs: broken });
    expect(res.timeline.documents).toHaveLength(1);
  });
});

describe('removeRecord', () => {
  it('removes the record, events and its vector chunks, scoped to the case', async () => {
    const deps = fresh();
    const { document } = await addRecord(CASE, { title: 'T', text: TEXT }, deps);
    expect(await removeRecord('other', document.id, deps)).toBe(false);
    expect(await removeRecord(CASE, document.id, deps)).toBe(true);
    expect((await loadTimeline(CASE, deps.store)).documents).toEqual([]);
    expect(await deps.docs.list(CASE)).toEqual([]);
    expect(await removeRecord(CASE, document.id, deps)).toBe(false);
  });
});
