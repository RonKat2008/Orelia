import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// Ownership/CSRF are covered in tests/auth; these tests exercise the route body.
const guard = vi.hoisted(() => ({ guardCase: vi.fn(async (...args: [Request, string]): Promise<Response | null> => (void args, null)) }));
vi.mock('@/lib/auth/ownership', () => ({ guardCase: guard.guardCase }));
import { GET, POST } from '@/app/api/cases/[id]/documents/route';
import { getServices } from '@/app/api/cases/_lib/services';
import { patientNoteSchema } from '@/lib/contracts/case-docs';

const state = globalThis as unknown as { __wayfinderServices?: unknown; __wayfinderDocuments?: unknown };
beforeEach(() => { vi.stubEnv('DATABASE_URL', ''); vi.stubEnv('WAYFINDER_OFFLINE', '1'); delete state.__wayfinderServices; delete state.__wayfinderDocuments; });
afterEach(() => { vi.unstubAllEnvs(); delete state.__wayfinderServices; delete state.__wayfinderDocuments; });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) => new Request('http://localhost/api/cases/id/documents', { method: 'POST', body: JSON.stringify(body) });
it('routes call the ownership guard', async () => {
  const id = randomUUID();
  await GET(new Request('http://localhost'), ctx(id));
  expect(guard.guardCase).toHaveBeenCalledWith(expect.any(Request), id);
});
it('validates patient notes with a known consent field and <=20k characters', () => {
  const valid = { title: 'Note', text: 'hello', sharedField: 'diseaseName' };
  expect(patientNoteSchema.safeParse(valid).success).toBe(true);
  for (const patch of [{ text: '' }, { text: 'x'.repeat(20001) }, { sharedField: 'intakeReport' }, { sharedField: null }, { sharedField: 'invented' }, { caseId: randomUUID() }]) {
    expect(patientNoteSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  }
});
it('returns 400 for invalid input and 404 for unknown cases', async () => {
  expect((await GET(new Request('http://localhost'), ctx('invalid'))).status).toBe(400);
  expect((await GET(new Request('http://localhost'), ctx(randomUUID()))).status).toBe(404);
  expect((await POST(request({ title: 'Note', text: 'x', sharedField: 'diseaseName' }), ctx(randomUUID()))).status).toBe(404);
  expect((await POST(request({ text: 'x' }), ctx(randomUUID()))).status).toBe(400);
});
it('creates notes and lists metadata without embeddings or private content, isolated by case', async () => {
  const first = await getServices().cases.create({ diseaseName: 'synthetic', goals: [] });
  const other = await getServices().cases.create({ diseaseName: 'other', goals: [] });
  const response = await POST(request({ title: 'Note', text: 'synthetic note', sharedField: 'diseaseName' }), ctx(first.id));
  expect(response.status).toBe(201);
  const { documents } = await (await GET(new Request('http://localhost'), ctx(first.id))).json();
  expect(documents).toHaveLength(1);
  expect(Object.keys(documents[0]).sort()).toEqual(['contactId', 'createdAt', 'id', 'kind', 'sharedField', 'title']);
  expect(documents[0].sharedField).toBe('diseaseName');
  expect(await (await GET(new Request('http://localhost'), ctx(other.id))).json()).toEqual({ documents: [] });
});
