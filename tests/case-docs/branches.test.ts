import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

type Terminal = 'returning' | 'limit' | 'where' | 'orderBy';
let queue: unknown[][] = [];
const captured: { op: string; values?: unknown; where?: unknown }[] = [];
/** Thenable drizzle-style chain; every query settles with the next queued result set. */
function chain(op: string) {
  const entry: { op: string; values?: unknown; where?: unknown } = { op };
  captured.push(entry);
  const settle = () => queue.shift() ?? [];
  const c: Record<string, unknown> & Record<Terminal, unknown> = {
    values: (v: unknown) => { entry.values = v; return c; },
    from: () => c,
    where: (w: unknown) => { entry.where = w; return c; },
    orderBy: () => c,
    limit: () => c,
    returning: async () => settle(),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(settle()).then(res, rej),
  };
  return c;
}
const fakeDb = { insert: () => chain('insert'), select: () => chain('select') };
vi.mock('@/db/client', () => ({ getDb: () => fakeDb }));

import { chunk, getDocumentStore, ingest, MemoryDocumentStore, PostgresDocumentStore, search } from '@/lib/case-docs';
import { ingestCaseSummary, ingestEvidence, ingestInbound } from '@/lib/case-docs/hooks';
import { consentFields, resultLimit } from '@/lib/case-docs/store';

type Store = ConstructorParameters<typeof PostgresDocumentStore>[0];
const pg = () => new PostgresDocumentStore(fakeDb as unknown as Store);
const sqlOf = (w: unknown) => new PgDialect().sqlToQuery(w as never);
const state = globalThis as { __wayfinderDocuments?: unknown };

beforeEach(() => { queue = []; captured.length = 0; vi.stubEnv('WAYFINDER_OFFLINE', '1'); delete state.__wayfinderDocuments; });
afterEach(() => { vi.unstubAllEnvs(); delete state.__wayfinderDocuments; });

describe('PostgresDocumentStore', () => {
  it('insert of nothing never hits the database', async () => {
    expect(await pg().insert([])).toEqual([]);
    expect(captured).toHaveLength(0);
  });
  it('insert returns the rows the database reports back', async () => {
    queue = [[{ id: 'd1' }]];
    const rows = await pg().insert([{ caseId: 'a', contactId: null, kind: 'evidence', title: 't', sourceUrl: null, sharedField: null, chunkIndex: 0, content: 'c', embedding: [0], embedModel: 'm' }]);
    expect(rows).toEqual([{ id: 'd1' }]);
    expect((captured[0]!.values as unknown[]).length).toBe(1);
  });
  it('list scopes by case id', async () => {
    queue = [[{ id: 'd1' }]];
    expect(await pg().list('case-a')).toEqual([{ id: 'd1' }]);
    expect(sqlOf(captured[0]!.where).params).toEqual(['case-a']);
  });
  it('text returns undefined for a document id that is not in this case', async () => {
    queue = [[]];
    expect(await pg().text('case-a', 'doc-x')).toBeUndefined();
    expect(captured).toHaveLength(1);
  });
  it('text joins the chunks of a case-wide document, matching on a null contact', async () => {
    queue = [[{ id: 'd1', kind: 'evidence', title: 'T', contactId: null }], [{ content: 'one' }, { content: 'two' }]];
    expect(await pg().text('case-a', 'd1')).toEqual({ id: 'd1', kind: 'evidence', title: 'T', content: 'one\ntwo' });
    const { sql, params } = sqlOf(captured[1]!.where);
    expect(sql).toContain('"contact_id" is null');
    expect(params).toEqual(['case-a', 'evidence', 'T']);
  });
  it('text keeps a contact-owned document scoped to its contact', async () => {
    queue = [[{ id: 'd1', kind: 'inbound_message', title: 'T', contactId: 'c1' }], [{ content: 'x' }]];
    await pg().text('case-a', 'd1');
    const { sql, params } = sqlOf(captured[1]!.where);
    expect(sql).not.toContain('"contact_id" is null');
    expect(params).toEqual(['case-a', 'inbound_message', 'T', 'c1']);
  });
  it('search with contactOnly excludes case-wide documents', async () => {
    await pg().search({ caseId: 'a', contactId: 'c1', contactOnly: true, query: 'q', allowedFields: [], embedding: [1], embedModel: 'm' });
    const { sql } = sqlOf(captured[0]!.where);
    expect(sql).toContain('"contact_id" = $');
    expect(sql).not.toContain('"contact_id" is null or');
  });
});

describe('MemoryDocumentStore.text', () => {
  const row = (over: object) => ({ caseId: 'a', contactId: null, kind: 'evidence' as const, title: 'T', sourceUrl: null, sharedField: null, chunkIndex: 0, content: 'x', embedding: [1], embedModel: 'm', ...over });
  it('returns undefined for another case id even if the document id exists', async () => {
    const store = new MemoryDocumentStore();
    const [doc] = await store.insert([row({})]);
    expect(await store.text('b', doc!.id)).toBeUndefined();
    expect(await store.text('a', 'missing')).toBeUndefined();
  });
  it('joins only same-title, same-contact chunks, in chunk order', async () => {
    const store = new MemoryDocumentStore();
    const docs = await store.insert([
      row({ chunkIndex: 1, content: 'second' }), row({ chunkIndex: 0, content: 'first' }),
      row({ title: 'Other', content: 'nope' }), row({ contactId: 'c1', content: 'private' }),
    ]);
    expect((await store.text('a', docs[0]!.id))!.content).toBe('first\nsecond');
  });
});

describe('store helpers', () => {
  it('consentFields drops unknown field names', () => {
    expect(consentFields(['diseaseName', 'bogus'])).toEqual(['diseaseName']);
  });
  it.each([[undefined, 5], [0, 1], [-4, 1], [3.9, 3], [500, 50], [NaN, 5], [Infinity, 5]])('resultLimit(%j) = %j', (k, expected) => {
    expect(resultLimit(k)).toBe(expected);
  });
});

describe('chunk edge cases', () => {
  it('returns [] for empty input', () => {
    expect(chunk('')).toEqual([]);
  });
  it.each([[0, 0], [10, -1], [1.5, 0], [10, 0.5], [10, 10], [10, 11]])('rejects window size=%j overlap=%j', (size, overlap) => {
    expect(() => chunk('abc', size, overlap)).toThrow('Invalid chunk window');
  });
  it('emits a single chunk when text exactly fits the window', () => {
    expect(chunk('abcdef', 6, 2)).toEqual(['abcdef']);
  });
  it('trims each window and skips windows that are only whitespace after trimming', () => {
    // input is trimmed first, but an interior run of spaces can fill a whole window
    expect(chunk(`a${' '.repeat(6)}b`, 3, 0)).toEqual(['a', 'b']);
  });
});

describe('getDocumentStore selection', () => {
  it('uses memory when WAYFINDER_OFFLINE=1 even if DATABASE_URL is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic.invalid/db');
    expect(getDocumentStore()).toBeInstanceOf(MemoryDocumentStore);
  });
  it('uses memory when DATABASE_URL is unset', () => {
    vi.stubEnv('WAYFINDER_OFFLINE', '0'); vi.stubEnv('DATABASE_URL', '');
    expect(getDocumentStore()).toBeInstanceOf(MemoryDocumentStore);
  });
  it('uses Postgres when online with DATABASE_URL, and caches the instance', () => {
    vi.stubEnv('WAYFINDER_OFFLINE', '0'); vi.stubEnv('DATABASE_URL', 'postgres://synthetic.invalid/db');
    const store = getDocumentStore();
    expect(store).toBeInstanceOf(PostgresDocumentStore);
    expect(getDocumentStore()).toBe(store);
  });
});

describe('ingest classification and search defaults', () => {
  it('forces intake reports onto the intakeReport field regardless of caller metadata', async () => {
    const store = new MemoryDocumentStore();
    const rows = await ingest({ caseId: 'a', kind: 'intake_report', title: 'r', sharedField: 'insurer', text: 'x' }, store);
    expect(rows[0]!.sharedField).toBe('intakeReport');
  });
  it('keeps public kinds public and everything else unshared by default', async () => {
    const store = new MemoryDocumentStore();
    expect((await ingest({ caseId: 'a', kind: 'resource_page', title: 'r', text: 'x' }, store))[0]!.sharedField).toBeNull();
    expect((await ingest({ caseId: 'a', kind: 'patient_note', title: 'r', text: 'x' }, store))[0]!.sharedField).toBe('unshared');
  });
  it('whitespace-only text produces no rows', async () => {
    expect(await ingest({ caseId: 'a', kind: 'evidence', title: 'r', text: '   ' }, new MemoryDocumentStore())).toEqual([]);
  });
  it('search uses the default store when none is passed', async () => {
    expect(await search({ caseId: 'a', query: 'q', allowedFields: [] })).toEqual([]);
  });
});

describe('hooks', () => {
  it('ingestCaseSummary skips null, empty-string and empty-array fields and JSON-encodes non-strings', async () => {
    const store = new MemoryDocumentStore();
    await ingestCaseSummary({ id: 'a', diseaseName: 'synthetic disease', insurer: '', planId: null, homeState: undefined, medications: [], diagnoses: ['x'] }, store);
    const contents = await Promise.all((await store.list('a')).map(d => store.text('a', d.id)));
    expect(contents.map(c => c!.content)).toContain('diseaseName: synthetic disease');
    expect(contents.map(c => c!.content).join('\n')).not.toMatch(/insurer|planId|homeState|medications/);
  });
  it('ingestEvidence labels untyped rows "Evidence" and keeps provided claim types', async () => {
    const store = new MemoryDocumentStore();
    await ingestEvidence('a', [{ claim: 'c1', sourceUrl: 'https://e.test/1' }, { claim: 'c2', sourceUrl: 'https://e.test/2', claimType: 'trial' }], store);
    expect((await store.list('a')).map(d => d.title).sort()).toEqual(['Evidence', 'trial']);
  });
  it('ingestInbound routes bodies and transcripts to different kinds, with default title and empty text', async () => {
    const store = new MemoryDocumentStore();
    const resolveContact = async () => ({ caseId: 'a' });
    await ingestInbound('c1', { body: 'hello' }, { store, resolveContact });
    await ingestInbound('c1', { transcript: 'spoken', title: 'Call' }, { store, resolveContact });
    expect(await ingestInbound('c1', {}, { store, resolveContact })).toEqual([]);
    const kinds = Object.fromEntries((await store.list('a')).map(d => [d.title, d.kind]));
    expect(kinds).toEqual({ 'Inbound correspondence': 'inbound_message', Call: 'call_transcript' });
  });
  it('an empty-string transcript still counts as a call transcript', async () => {
    const store = new MemoryDocumentStore();
    await ingestInbound('c1', { transcript: '', body: 'ignored' }, { store, resolveContact: async () => ({ caseId: 'a' }) });
    expect(await store.list('a')).toEqual([]);
  });
  it('resolves the owning case from the database by default, never from message content', async () => {
    queue = [[{ caseId: 'case-from-db' }]];
    const store = new MemoryDocumentStore();
    await ingestInbound('c1', { body: 'reply claiming case-evil' }, { store });
    expect((await store.list('case-from-db')).length).toBe(1);
    expect(sqlOf(captured[0]!.where).params).toContain('c1');
  });
  it('throws "Contact not found" when the default lookup finds nothing', async () => {
    queue = [[]];
    await expect(ingestInbound('ghost', { body: 'x' }, { store: new MemoryDocumentStore() })).rejects.toThrow('Contact not found');
  });
});
