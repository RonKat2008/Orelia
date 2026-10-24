import { describe, expect, it } from 'vitest';
import { MemoryHistoryStore } from '@/lib/history/store';
import type { HistoryDocument, HistoryEvent } from '@/lib/history/contract';

const DOC = '22222222-2222-4222-8222-222222222222';
const doc = (over: Partial<HistoryDocument> = {}): HistoryDocument => ({
  id: DOC, caseId: 'case-a', title: 'Genetics visit', docType: 'visit_note', text: 'Synthetic note text.',
  createdAt: '2026-01-01T00:00:00.000Z', extractedBy: 'rules', ...over,
});
const ev = (over: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'ev-1', date: '2024-03', kind: 'specialist_visit', title: 'Visit', provider: null, institution: null,
  findings: ['Synthetic note'], sourceDocId: DOC, span: { start: 0, end: 9 }, ...over,
});

describe('MemoryHistoryStore', () => {
  it('stores and lists documents and events per case', async () => {
    const s = new MemoryHistoryStore();
    await s.addDocument(doc(), [ev()]);
    await s.addDocument(doc({ id: '33333333-3333-4333-8333-333333333333', caseId: 'case-b' }), []);
    expect((await s.listDocuments('case-a')).map(d => d.id)).toEqual([DOC]);
    expect(await s.listEvents('case-a')).toHaveLength(1);
    expect(await s.listEvents('case-b')).toEqual([]);
  });
  it('returns deep copies that cannot mutate saved state', async () => {
    const s = new MemoryHistoryStore();
    const input = doc(); const events = [ev()];
    await s.addDocument(input, events);
    input.title = 'changed'; events[0].findings.push('x');
    (await s.listDocuments('case-a'))[0].title = 'mutated';
    (await s.listEvents('case-a'))[0].findings.length = 0;
    expect((await s.getDocument('case-a', DOC))?.title).toBe('Genetics visit');
    expect((await s.listEvents('case-a'))[0].findings).toEqual(['Synthetic note']);
  });
  it('rejects invalid documents and events', async () => {
    const s = new MemoryHistoryStore();
    await expect(s.addDocument(doc({ title: '' }), [])).rejects.toThrow();
    await expect(s.addDocument(doc(), [ev({ title: '' })])).rejects.toThrow();
    await expect(s.addDocument(doc(), [ev({ sourceDocId: 'other' })])).rejects.toThrow();
    expect(await s.listDocuments('case-a')).toEqual([]);
  });
  it('getDocument and deleteDocument are scoped to the case', async () => {
    const s = new MemoryHistoryStore();
    await s.addDocument(doc(), [ev()]);
    expect(await s.getDocument('case-b', DOC)).toBeUndefined();
    expect(await s.deleteDocument('case-b', DOC)).toBe(false);
    expect(await s.deleteDocument('case-a', DOC)).toBe(true);
    expect(await s.listEvents('case-a')).toEqual([]);
    expect(await s.deleteDocument('case-a', DOC)).toBe(false);
  });
});
