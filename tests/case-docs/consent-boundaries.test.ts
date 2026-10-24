import { describe, expect, it } from 'vitest';
import { MemoryDocumentStore, resultLimit, type NewDocument } from '../../lib/case-docs/store';

const row = (changes: Partial<NewDocument> = {}): NewDocument => ({
  caseId: 'synthetic-case', contactId: null, kind: 'evidence', title: 'Synthetic resource', sourceUrl: 'https://example.test/resource', sharedField: null, chunkIndex: 0, content: 'Synthetic coordination resource', embedding: [1, 0], embedModel: 'synthetic-model', ...changes,
});
const query = { caseId: 'synthetic-case', query: 'resource', allowedFields: [], embedding: [1, 0], embedModel: 'synthetic-model' };

describe('document retrieval boundaries', () => {
  it.each([[NaN, 5], [Infinity, 5], [-Infinity, 5], [-1, 1], [0, 1], [1.9, 1], [51, 50]])('bounds result limit %s to %s', (input, expected) => {
    expect(resultLimit(input)).toBe(expected);
  });
  it('does not permit arbitrary field names to authorize private documents', async () => {
    const store = new MemoryDocumentStore();
    await store.insert([row({ kind: 'patient_note', sharedField: 'secretField' })]);
    expect(await store.search({ ...query, allowedFields: ['secretField'] })).toEqual([]);
  });
  it('returns zero similarity for zero vectors without exposing embeddings', async () => {
    const store = new MemoryDocumentStore();
    await store.insert([row({ embedding: [0, 0] })]);
    const results = await store.search(query);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0);
    expect(results[0]).not.toHaveProperty('embedding');
  });
  it('orders eligible snippets by cosine similarity before applying the limit', async () => {
    const store = new MemoryDocumentStore();
    await store.insert([row({ title: 'weak', embedding: [0, 1] }), row({ title: 'strong' })]);
    expect((await store.search({ ...query, k: 1 })).map(result => result.title)).toEqual(['strong']);
  });
  it('isolates persisted documents from mutations of input, insert output, list and search output', async () => {
    const store = new MemoryDocumentStore();
    const original = row();
    const [inserted] = await store.insert([original]);
    original.embedding[0] = 0;
    inserted.content = 'changed';
    inserted.embedding[0] = 0;
    const [listed] = await store.list(query.caseId);
    listed.title = 'changed';
    const [found] = await store.search(query);
    found.content = 'also changed';
    const [again] = await store.search(query);
    expect(again).toMatchObject({ title: 'Synthetic resource', content: 'Synthetic coordination resource', score: 1 });
  });
});
