import { describe, expect, it } from 'vitest';
import { ingest, search } from '@/lib/case-docs';
import { MemoryDocumentStore, consentFields } from '@/lib/case-docs/store';
import { SHARED_FIELDS } from '@/lib/outreach/draft';
import { HISTORY_DOC_FIELD } from '@/lib/history/contract';

describe('medical_record chunks and consent', () => {
  it('consentFields never keeps HISTORY_DOC_FIELD (only includeMedicalRecords opts in)', () => {
    expect(consentFields([HISTORY_DOC_FIELD])).toEqual([]);
    expect(consentFields(SHARED_FIELDS)).not.toContain(HISTORY_DOC_FIELD);
    expect((SHARED_FIELDS as readonly string[]).includes(HISTORY_DOC_FIELD)).toBe(false);
  });
  it('outreach-style search never returns medical_record chunks; history search does', async () => {
    const docs = new MemoryDocumentStore();
    await ingest({ caseId: 'c1', kind: 'medical_record', title: 'Genetics report', text: 'COL3A1 variant reported in synthetic record', sharedField: HISTORY_DOC_FIELD }, docs);
    await ingest({ caseId: 'c1', kind: 'evidence', title: 'Public page', text: 'COL3A1 expert clinic public resource' }, docs);
    const outreach = await search({ caseId: 'c1', query: 'COL3A1 variant', allowedFields: SHARED_FIELDS, k: 20 }, docs);
    expect(outreach.some(r => r.kind === 'medical_record')).toBe(false);
    expect(outreach.length).toBeGreaterThan(0);
    // Even an unvalidated caller passing the tag as a "field" gets nothing without the explicit opt-in.
    const smuggled = await search({ caseId: 'c1', query: 'COL3A1 variant', allowedFields: [HISTORY_DOC_FIELD], k: 20 }, docs);
    expect(smuggled.some(r => r.kind === 'medical_record')).toBe(false);
    const history = await search({ caseId: 'c1', query: 'COL3A1 variant', allowedFields: [], includeMedicalRecords: true, k: 20 }, docs);
    expect(history.some(r => r.kind === 'medical_record')).toBe(true);
  });
  it('deleteByTitle removes only the matching record chunks', async () => {
    const docs = new MemoryDocumentStore();
    await ingest({ caseId: 'c1', kind: 'medical_record', title: 'A', text: 'alpha', sharedField: HISTORY_DOC_FIELD }, docs);
    await ingest({ caseId: 'c1', kind: 'medical_record', title: 'B', text: 'beta', sharedField: HISTORY_DOC_FIELD }, docs);
    expect(await docs.deleteByTitle('c1', 'medical_record', 'A')).toBeGreaterThan(0);
    expect((await docs.list('c1')).map(d => d.title)).toEqual(['B']);
  });
});
