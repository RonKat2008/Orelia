import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWebChannel } from '@/lib/channels/mock-browser';
import { fingerprintFields, type PageField } from '@/lib/channels/browser-types';
import { composeDisclosureNote } from '@/lib/agents/form-mapper';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { MissingField, WebApplicationDraft } from '@/lib/web-application/types';

const FORM_URL = 'http://localhost:3000/demo/intake-form/organization-demo';
const ALLOW = ['localhost:3000'];
const f = (key: string, label: string, type: PageField['type'], required = false): PageField => ({ key, label, type, required });
/** Mirrors app/demo/intake-form/[resource]/page.tsx. */
const DEMO_FORM: PageField[] = [
  f('first_name', 'First name *', 'text', true), f('last_name', 'Last name *', 'text', true), f('date_of_birth', 'Date of birth *', 'date', true),
  f('email', 'Email *', 'email', true), f('phone', 'Phone *', 'tel', true), f('city', 'City', 'text'), f('state', 'State', 'text'),
  f('diagnosis', 'Diagnosis or condition *', 'text', true), f('reason_for_visit', 'Reason for visit *', 'textarea', true),
];
const channel = new MockWebChannel({ pages: { [FORM_URL]: { fields: DEMO_FORM } }, guard: { allowlist: [], webAllowlist: ALLOW } });
const record = { diseaseName: 'vascular Ehlers-Danlos syndrome', homeState: 'OH', goals: [] };

vi.mock('@/app/api/cases/_lib/services', () => ({ getServices: () => ({ cases: { get: async (id: string) => ({ id }) } }) }));
vi.mock('@/lib/demo-live/start', () => ({ liveDemoEnabled: () => true }));
vi.mock('@/lib/demo-live/skip-ahead', () => ({ isLiveDemoCase: async () => true }));
vi.mock('@/lib/web-application/server', () => ({
  defaultApproveDeps: () => ({
    applications: (globalThis as unknown as { __wayfinderApplications: MemoryApplicationStore }).__wayfinderApplications,
    env: { OUTBOUND_WEB_ALLOWLIST: 'localhost:3000', NODE_ENV: 'test' },
    outreach: {
      getCase: async () => record,
      consent: async () => ({ sharedFields: ['diseaseName', 'homeState', 'goals'], approvedAt: '2026-10-24T11:00:00Z' }),
      contacts: async () => [{ id: 'contact-1', caseId: CASE, targetId: 't-1', state: 'drafted' }],
    },
    submit: async (gated: never) => { await channel.send(gated); },
  }),
}));
vi.mock('@/lib/agents/factory', () => ({ wakeAgentForApplication: async () => undefined }));

import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { approveAll } from '@/lib/demo-live/approve-all';
import * as appsRoute from '@/app/api/cases/[id]/applications/route';
import * as approveRoute from '@/app/api/cases/[id]/applications/[applicationId]/approve/route';
import * as answersRoute from '@/app/api/cases/[id]/applications/[applicationId]/answers/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const CASE = '11111111-1111-4111-8111-111111111111';
const APP = '33333333-3333-4333-8333-333333333333';
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderApplications?: unknown };
const cookie = `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`;

const missing = (field: PageField, reason: MissingField['reason'] = 'no_consented_source'): MissingField => ({
  fieldKey: field.key, label: field.label, required: field.required, reason, question: `What should we enter for "${field.label}"?`, type: field.type,
});

/** What the form mapper produces for the demo form from the demo consent: diagnosis, state and the disclosure. */
function filledDraft(): WebApplicationDraft {
  const byKey = new Map(DEMO_FORM.map(x => [x.key, x]));
  return {
    id: APP, caseId: CASE, contactId: 'contact-1', url: FORM_URL,
    fields: [
      { fieldKey: 'diagnosis', label: 'Diagnosis or condition *', type: 'text', value: record.diseaseName, source: { kind: 'consent', key: 'diseaseName' } },
      { fieldKey: 'state', label: 'State', type: 'text', value: 'OH', source: { kind: 'consent', key: 'homeState' } },
      { fieldKey: 'reason_for_visit', label: 'Reason for visit *', type: 'textarea', value: composeDisclosureNote(), source: { kind: 'disclosure' } },
    ],
    missing: ['first_name', 'last_name', 'date_of_birth', 'email', 'phone', 'city'].map(k => missing(byKey.get(k)!)),
    formFingerprint: fingerprintFields(DEMO_FORM), screenshot: null, sharedFields: ['diseaseName', 'homeState', 'goals'], sharedDocIds: [],
    status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: '2026-10-24T12:00:00.000Z',
  };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
/** The patient's browser: only the application routes are needed once the plan and messages are done. */
async function fetchFn(path: string, init?: RequestInit): Promise<Response> {
  const req = new Request(`${ORIGIN}${path}`, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie, origin: ORIGIN } });
  const method = (init?.method ?? 'GET') as 'GET' | 'POST';
  const p = new URL(req.url).pathname;
  let m = /^\/api\/cases\/([^/]+)\/applications\/([^/]+)\/answers$/.exec(p);
  if (m) return (answersRoute[method as 'GET' | 'POST'] as Handler)(req, { params: Promise.resolve({ id: m[1]!, applicationId: m[2]! }) });
  m = /^\/api\/cases\/([^/]+)\/applications\/([^/]+)\/approve$/.exec(p);
  if (m) return (approveRoute.POST as Handler)(req, { params: Promise.resolve({ id: m[1]!, applicationId: m[2]! }) });
  m = /^\/api\/cases\/([^/]+)\/applications$/.exec(p);
  if (m) return (appsRoute.GET as Handler)(req, { params: Promise.resolve({ id: m[1]! }) });
  // Plan and contacts: nothing waiting.
  if (p.endsWith('/plan')) return Response.json({ plan: null });
  if (p.endsWith('/contacts')) return Response.json({ contacts: [] });
  return new Response('not found', { status: 404 });
}

let store: MemoryApplicationStore;
beforeEach(() => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', '');
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  store = new MemoryApplicationStore();
  holder.__wayfinderApplications = store;
});
afterEach(() => { vi.unstubAllEnvs(); delete holder.__wayfinderOwnerStore; delete holder.__wayfinderApplications; });

describe('live demo "Approve all" completes the online-form path (mock browser)', () => {
  it('answers the form questions from the synthetic demo patient, then the gate passes and the form is submitted', async () => {
    await store.save(filledDraft());
    const items = await approveAll(CASE, fetchFn);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'application', label: 'Form questions', ok: true, detail: '5 answered from the demo patient' }),
      expect.objectContaining({ kind: 'application', label: 'Online application', ok: true }),
    ]);
    const row = (await store.get(APP))!;
    expect(row.status).toBe('submitted');
    expect(row.missing.map(x => x.fieldKey)).toEqual(['city']); // optional, and no synthetic city is invented
    const sent = channel.browser.submissions.at(-1)!;
    expect(sent.url).toBe(FORM_URL);
    expect(sent.values).toMatchObject({ first_name: 'Jordan', last_name: 'Demo', date_of_birth: '1990-01-01', email: 'ronit-1977@agentmail.to', diagnosis: record.diseaseName });
    expect(row.fields.find(x => x.fieldKey === 'first_name')?.source).toEqual({ kind: 'patient', origin: 'demo' });
  });
});
