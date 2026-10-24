import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { MemoryDocumentStore } from '@/lib/case-docs/store';
import { search as caseDocsSearch } from '@/lib/case-docs';
import { SHARED_FIELDS } from '@/lib/outreach/draft';
import type { HistoryTimeline } from '@/lib/history/contract';
import { MemoryHistoryStore, setHistoryStoreForTests } from '@/lib/history/store';
import { MemoryShareStore, resolveShare, setShareStoreForTests } from '@/lib/history/share';
import { GET } from '@/app/api/cases/[id]/history/route';
import { GET as SEARCH } from '@/app/api/cases/[id]/history/search/route';
import { POST as SAMPLE } from '@/app/api/cases/[id]/history/sample/route';
import { POST as SHARE } from '@/app/api/cases/[id]/history/share/route';
import { DELETE as REVOKE } from '@/app/api/cases/[id]/history/share/[shareId]/route';

const SECRET = 'flow-secret';
const ORIGIN = 'http://localhost';
const CASE = '22222222-2222-4222-8222-222222222222';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderDocuments?: unknown };
const saved: Record<string, string | undefined> = {};
const req = (path: string, method = 'GET', body?: unknown) => new Request(`${ORIGIN}/api/cases/${CASE}/history${path}`, {
  method,
  headers: { 'content-type': 'application/json', cookie: `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`, ...(method === 'GET' ? {} : { origin: ORIGIN }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ctx = { params: Promise.resolve({ id: CASE }) };

beforeEach(() => {
  for (const k of ['WAYFINDER_SESSION_SECRET', 'WAYFINDER_OFFLINE', 'DATABASE_URL']) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  process.env.WAYFINDER_OFFLINE = '1';
  delete process.env.DATABASE_URL;
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  holder.__wayfinderDocuments = new MemoryDocumentStore();
  setHistoryStoreForTests(new MemoryHistoryStore());
  setShareStoreForTests(new MemoryShareStore());
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderDocuments;
  setHistoryStoreForTests(undefined);
  setShareStoreForTests(undefined);
});

describe('medical history end-to-end (offline, synthetic)', () => {
  it('sample records -> timeline with conflicts -> search -> scoped share link -> revoke', async () => {
    const loaded = await SAMPLE(req('/sample', 'POST', { slug: 'vascular-eds' }), ctx);
    expect(loaded.status).toBe(201);
    const { timeline } = await (await GET(req(''), ctx)).json() as { timeline: HistoryTimeline };
    expect(timeline.documents.length).toBeGreaterThanOrEqual(4);
    expect(timeline.conflicts.map(c => c.kind)).toEqual(expect.arrayContaining(['diagnosis', 'variant_classification']));
    const docIds = new Set(timeline.documents.map(d => d.id));
    for (const e of timeline.events) expect(docIds.has(e.sourceDocId)).toBe(true);

    const hits = await (await SEARCH(req('/search?q=COL3A1'), ctx)).json() as { results: { docTitle: string }[] };
    expect(hits.results.length).toBeGreaterThan(0);

    // Outreach-style consent search never sees medical records.
    const outreach = await caseDocsSearch({ caseId: CASE, query: 'COL3A1 variant', allowedFields: SHARED_FIELDS });
    expect(outreach.some(s => s.kind === 'medical_record')).toBe(false);

    const created = await SHARE(req('/share', 'POST', { sections: ['genetic_test', 'conflicts'], expiresInDays: 7 }), ctx);
    expect(created.status).toBe(201);
    const { share, url } = await created.json() as { share: { id: string }; url: string };
    const token = url.split('/share/history/')[1];
    const resolved = await resolveShare(token, new Date());
    expect(resolved).not.toBeNull();
    const keys = resolved!.summary.sections.map(s => s.key);
    expect(keys).toEqual(['genetic_test', 'conflicts']);
    for (const s of resolved!.summary.sections) for (const e of s.events) expect(e.kind === 'genetic_test' || s.key === 'conflicts').toBe(true);

    const later = new Date(Date.now() + 8 * 86_400_000);
    expect(await resolveShare(token, later)).toBeNull();
    expect((await REVOKE(req(`/share/${share.id}`, 'DELETE'), { params: Promise.resolve({ id: CASE, shareId: share.id }) })).status).toBe(200);
    expect(await resolveShare(token, new Date())).toBeNull();
  });
});
