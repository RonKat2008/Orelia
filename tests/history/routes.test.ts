import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryDocumentStore } from '@/lib/case-docs/store';
import { MAX_RECORD_CHARS } from '@/lib/history/contract';
import { MemoryHistoryStore, setHistoryStoreForTests } from '@/lib/history/store';
import { GET, POST } from '@/app/api/cases/[id]/history/route';
import { DELETE } from '@/app/api/cases/[id]/history/documents/[docId]/route';
import { GET as SEARCH } from '@/app/api/cases/[id]/history/search/route';
import { POST as SAMPLE } from '@/app/api/cases/[id]/history/sample/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderDocuments?: unknown };
const saved: Record<string, string | undefined> = {};
const TEXT = 'Genetics clinic visit 2024-03-12. COL3A1 c.2357G>A variant of uncertain significance reported.';

type Opts = { method?: string; who?: string; origin?: string; body?: unknown; id?: string; query?: string };
const req = (path: string, o: Opts) => new Request(`${ORIGIN}/api/cases/${o.id ?? CASE}/history${path}${o.query ?? ''}`, {
  method: o.method ?? 'GET',
  headers: { 'content-type': 'application/json', cookie: cookie(o.who ?? 'owner'), ...(o.origin === undefined ? {} : { origin: o.origin }) },
  ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
});
const ctx = (o: Opts) => ({ params: Promise.resolve({ id: o.id ?? CASE }) });
const get = (o: Opts = {}) => GET(req('', o), ctx(o));
const post = (o: Opts = {}) => POST(req('', { method: 'POST', origin: ORIGIN, ...o }), ctx(o));
const del = (docId: string, o: Opts = {}) => DELETE(req(`/documents/${docId}`, { method: 'DELETE', origin: ORIGIN, ...o }), { params: Promise.resolve({ id: o.id ?? CASE, docId }) });
const search = (query: string, o: Opts = {}) => SEARCH(req('/search', { ...o, query }), ctx(o));
const sample = (o: Opts = {}) => SAMPLE(req('/sample', { method: 'POST', origin: ORIGIN, ...o }), ctx(o));

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_DEMO', 'WAYFINDER_OFFLINE', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  process.env.WAYFINDER_OFFLINE = '1';
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  holder.__wayfinderDocuments = new MemoryDocumentStore();
  setHistoryStoreForTests(new MemoryHistoryStore());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderDocuments;
  setHistoryStoreForTests(undefined);
});

describe('history routes: guards', () => {
  it('non-owner gets 404 on every route and nothing is written', async () => {
    expect((await get({ who: 'other' })).status).toBe(404);
    expect((await post({ who: 'other', body: { title: 'T', text: TEXT } })).status).toBe(404);
    expect((await search('?q=x', { who: 'other' })).status).toBe(404);
    expect((await del(CASE, { who: 'other' })).status).toBe(404);
    expect((await (await get()).json()).timeline.documents).toEqual([]);
  });
  it('rejects cross-origin writes', async () => {
    expect((await post({ origin: 'http://evil.example', body: { title: 'T', text: TEXT } })).status).toBeGreaterThanOrEqual(400);
    expect((await (await get()).json()).timeline.documents).toEqual([]);
  });
  it('rejects a malformed case id', async () => {
    expect((await get({ id: 'nope' })).status).toBe(400);
  });
});

describe('history routes: records', () => {
  it('GET returns an empty timeline initially', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).timeline).toEqual({ documents: [], events: [], conflicts: [] });
  });
  it('POST adds a record (201), GET shows it, search finds it, DELETE removes it', async () => {
    const res = await post({ body: { title: 'Genetics note', text: TEXT } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.document.title).toBe('Genetics note');
    expect(body.document).not.toHaveProperty('text');
    expect(body.timeline.documents).toHaveLength(1);

    const found = await (await search('?q=col3a1')).json();
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results[0].sourceDocId).toBe(body.document.id);

    const removed = await del(body.document.id);
    expect(removed.status).toBe(200);
    expect((await removed.json()).timeline.documents).toEqual([]);
    expect((await del(body.document.id)).status).toBe(404);
  });
  it('POST validates the body: 400 on bad shape, 413 on oversize text', async () => {
    expect((await post({ body: { title: '', text: TEXT } })).status).toBe(400);
    expect((await post({ body: { title: 'T', text: TEXT, extra: 1 } })).status).toBe(400);
    expect((await post({ body: { title: 'T', text: 'x'.repeat(MAX_RECORD_CHARS + 1) } })).status).toBe(413);
  });
  it('search validates q and k', async () => {
    expect((await search('')).status).toBe(400);
    expect((await search('?q=%20')).status).toBe(400);
    expect((await search('?q=x&k=0')).status).toBe(400);
    expect((await search('?q=x&k=5')).status).toBe(200);
  });
  it('DELETE rejects a non-uuid doc id', async () => {
    expect((await del('not-a-uuid')).status).toBe(400);
  });
});

describe('history routes: sample', () => {
  it('loads a synthetic fixture set once (idempotent) in offline mode', async () => {
    const first = await sample({ body: { slug: 'vascular-eds' } });
    expect(first.status).toBe(201);
    const n = (await first.json()).timeline.documents.length;
    expect(n).toBeGreaterThan(0);
    const again = await sample({ body: { slug: 'vascular-eds' } });
    expect((await again.json()).timeline.documents).toHaveLength(n);
  });
  it('rejects an unknown slug', async () => {
    expect((await sample({ body: { slug: 'not-a-slug' } })).status).toBe(400);
  });
  it('is 404 when neither demo nor offline is enabled', async () => {
    delete process.env.WAYFINDER_OFFLINE;
    expect((await sample({ body: { slug: 'vascular-eds' } })).status).toBe(404);
  });
});

describe('PDF upload route', () => {
  const upload = async (bytes: Uint8Array, name = 'letter.pdf', o: Opts = {}) => {
    const { POST: PDF } = await import('@/app/api/cases/[id]/history/pdf/route');
    const form = new FormData();
    form.set('file', new File([bytes as BlobPart], name, { type: 'application/pdf' }));
    const r = new Request(`${ORIGIN}/api/cases/${o.id ?? CASE}/history/pdf`, { method: 'POST', headers: { cookie: cookie(o.who ?? 'owner'), origin: ORIGIN }, body: form });
    return PDF(r, ctx(o));
  };

  it('adds a record from a text PDF', async () => {
    const { makePdf } = await import('./pdf-fixture');
    const res = await upload(makePdf([['Genetics clinic visit 2024-03-12. COL3A1 c.2357G>A variant of uncertain significance reported.']]));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.timeline.documents.map((d: { title: string }) => d.title)).toContain('letter');
  });

  it('rejects a scanned PDF with a friendly 422 and does not store anything', async () => {
    const { makePdf } = await import('./pdf-fixture');
    const res = await upload(makePdf([[]]));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/paste/i);
    expect((await (await get()).json()).timeline.documents).toEqual([]);
  });

  it('denies other users', async () => {
    const { makePdf } = await import('./pdf-fixture');
    expect((await upload(makePdf([['Some record text for the test run.']]), 'a.pdf', { who: 'intruder' })).status).toBeGreaterThanOrEqual(403);
  });
});
