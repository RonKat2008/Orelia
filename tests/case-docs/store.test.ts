import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunk, ingest, search, MemoryDocumentStore } from '@/lib/case-docs';
import { ingestCaseSummary, ingestInbound } from '@/lib/case-docs/hooks';
import { caseDocsTool } from '@/lib/case-docs/tool';

beforeEach(() => vi.stubEnv('WAYFINDER_OFFLINE', '1'));
afterEach(() => vi.unstubAllEnvs());
describe('chunking', () => {
  it('bounds chunks and retains overlap even for unbroken text', () => {
    const input = 'a'.repeat(7000);
    const rows = chunk(input);
    expect(rows.map(row => row.length)).toEqual([3200, 3200, 1400]);
    expect(chunk('  ')).toEqual([]);
    expect(chunk('short')).toEqual(['short']);
    expect(chunk('abcdefghij', 6, 2)).toEqual(['abcdef', 'efghij']);
    expect(() => chunk('text', 3, 3)).toThrow();
  });
});
describe('consent and tenant isolation', () => {
  it('filters before limiting; excludes other cases, contacts, fields and all raw intake', async () => {
    const store = new MemoryDocumentStore();
    const add = (overrides: Partial<Parameters<typeof ingest>[0]>) => ingest({ caseId: 'a', kind: 'evidence', title: 'row', text: 'sarcoma', ...overrides }, store);
    await add({ caseId: 'b', title: 'other case' });
    await add({ contactId: 'contact-b', title: 'other contact' });
    await add({ kind: 'patient_note', sharedField: 'insurer', title: 'private insurer' });
    await add({ kind: 'patient_note', title: 'missing metadata' });
    await add({ kind: 'intake_report', sharedField: 'diseaseName', title: 'raw intake' });
    await add({ kind: 'case_summary', sharedField: 'diseaseName', title: 'diagnosis' });
    await add({ contactId: 'contact-a', title: 'own contact' });
    await add({ title: 'public' });
    const find = (fields: string[], contactId?: string, k = 20) => search({ caseId: 'a', contactId, query: 'sarcoma', k, allowedFields: fields }, store);
    expect((await find(['diseaseName', 'intakeReport'], 'contact-a')).map(row => row.title).sort()).toEqual(['diagnosis', 'own contact', 'public']);
    expect((await find([])).map(row => row.title)).toEqual(['public']);
    expect(await find(['diseaseName'], 'contact-a', 1)).toHaveLength(1);
    expect((await store.list('a')).every(row => !('embedding' in row) && !('content' in row))).toBe(true);
  });
  it('rejects unsafe null-field patient rows even when bypassing ingest and mismatched embedding spaces', async () => {
    const store = new MemoryDocumentStore();
    const [row] = await ingest({ caseId: 'a', kind: 'patient_note', title: 'private', sharedField: 'insurer', text: 'secret' }, store);
    await store.insert([{ ...row, sharedField: null }]);
    await store.insert([{ ...row, kind: 'evidence', sharedField: null, embedModel: 'another-model' }]);
    expect(await search({ caseId: 'a', query: 'secret', allowedFields: [] }, store)).toEqual([]);
  });
  it('splits summaries by field and inbound defaults to unshared', async () => {
    const store = new MemoryDocumentStore();
    await ingestCaseSummary({ id: 'a', diseaseName: 'sarcoma', insurer: 'private plan', intakeReport: 'raw text' }, store);
    await ingestInbound('contact-a', { body: 'private reply' }, { store, resolveContact: async () => ({ caseId: 'a' }) });
    const rows = await search({ caseId: 'a', contactId: 'contact-a', query: 'sarcoma', allowedFields: ['diseaseName'] }, store);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('diseaseName: sarcoma');
    await expect(ingestInbound('missing', { body: 'reply' }, { store, resolveContact: async () => undefined })).rejects.toThrow('Contact not found');
  });
  it('tool scope cannot be overridden by model input and returns source provenance', async () => {
    const store = new MemoryDocumentStore();
    await ingest({ caseId: 'a', kind: 'evidence', title: 'public', text: 'resource', sourceUrl: 'https://example.com' }, store);
    const tool = caseDocsTool('a', 'contact-a', [], store);
    expect(tool.inputSchema.safeParse({ query: 'resource', caseId: 'b' }).success).toBe(false);
    const rows = await tool.handler({ query: 'resource' } as never) as { source_url: string }[];
    expect(rows[0].source_url).toBe('https://example.com');
  });
});
