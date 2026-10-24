/**
 * Route-level: POST /api/cases/[id]/applications/[applicationId]/approve -> outbound gate -> submitGated exactly once,
 * through the real KernelPlanWebForm port and WebFormChannel over the in-memory mock browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CASE = '11111111-1111-4111-8111-111111111111';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const APP = '33333333-3333-4333-8333-333333333333';
const record = { diseaseName: 'Epithelioid sarcoma', goals: ['second opinion', 'clinical trial'] };
const outreachStore = vi.hoisted(() => ({
  consentFields: ['diseaseName', 'goals'] as string[],
  contacts: [] as Record<string, unknown>[],
}));

vi.mock('@/app/api/cases/_lib/services', () => ({ getServices: () => ({ cases: { get: async (id: string) => ({ id }) } }) }));
vi.mock('@/lib/outreach/postgres-store', () => ({
  PostgresOutreachStore: class {
    async getCase() { return record; }
    async consent(id: string) { return id === CONTACT ? { contactId: CONTACT, sharedFields: outreachStore.consentFields, approvedAt: '2026-10-24T11:00:00Z' } : undefined; }
    async contacts() { return outreachStore.contacts; }
  },
}));

import { MemoryOwnerStore } from '@/lib/auth/ownership';
import { signSession } from '@/lib/auth/session';
import { fingerprintFields, type PageField } from '@/lib/channels/browser-types';
import { MockBrowserProvider } from '@/lib/channels/mock-browser';
import { WebFormChannel as BrowserWebFormChannel } from '@/lib/channels/web-form';
import { KernelPlanWebForm, setWebFormChannelForTests } from '@/lib/plan/channels';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { formatFieldValue } from '@/lib/safety/field-value';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import { POST } from '@/app/api/cases/[id]/applications/[applicationId]/approve/route';

const SECRET = 'test-secret';
const ORIGIN = 'http://localhost';
const FORM_URL = 'http://localhost:3000/dev/test-application';
const page: PageField[] = [
  { key: 'diagnosis', label: 'Diagnosis', type: 'text', required: true },
  { key: 'goals', label: 'What are you hoping for?', type: 'text', required: false },
  { key: 'notes', label: 'Anything else you want to tell us', type: 'textarea', required: false },
];
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderApplications?: unknown };
const cookie = `wf_session=${signSession('owner', { WAYFINDER_SESSION_SECRET: SECRET })}`;

const draft = (): WebApplicationDraft => ({
  id: APP, caseId: CASE, contactId: CONTACT, url: FORM_URL,
  fields: [
    { fieldKey: 'diagnosis', label: 'Diagnosis', type: 'text', value: 'Epithelioid sarcoma', source: { kind: 'consent', key: 'diseaseName' } },
    { fieldKey: 'goals', label: 'What are you hoping for?', type: 'text', value: formatFieldValue(record.goals)!, source: { kind: 'consent', key: 'goals' } },
    { fieldKey: 'notes', label: 'Anything else you want to tell us', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
  ],
  missing: [], formFingerprint: fingerprintFields(page), screenshot: 'png', sharedFields: ['diseaseName', 'goals'], sharedDocIds: [],
  status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: '2026-10-24T12:00:00.000Z',
});

let store: MemoryApplicationStore;
let provider: MockBrowserProvider;
beforeEach(async () => {
  vi.stubEnv('WAYFINDER_SESSION_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL', 'postgres://unused.invalid/db');
  vi.stubEnv('OUTBOUND_WEB_ALLOWLIST', 'localhost:3000');
  const owners = new MemoryOwnerStore();
  owners.registerCase(CASE, 'owner');
  holder.__wayfinderOwnerStore = owners;
  store = new MemoryApplicationStore();
  holder.__wayfinderApplications = store;
  await store.save(draft());
  outreachStore.consentFields = ['diseaseName', 'goals'];
  outreachStore.contacts = [{ id: CONTACT, caseId: CASE, targetId: 't-1', state: 'drafted', address: 'intake@example.org' }];
  provider = new MockBrowserProvider({ [FORM_URL]: { fields: page } });
  const browser = new BrowserWebFormChannel({ provider, guard: { allowlist: [], webAllowlist: ['localhost:3000'] } });
  setWebFormChannelForTests(new KernelPlanWebForm({ channel: () => browser, applications: () => store, context: async () => null }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  setWebFormChannelForTests(undefined);
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderApplications;
});

const approve = () => POST(new Request(`${ORIGIN}/api/cases/${CASE}/applications/${APP}/approve`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie, origin: ORIGIN }, body: '{}',
}), { params: Promise.resolve({ id: CASE, applicationId: APP }) });

describe('POST application approve -> gate -> submitGated', () => {
  it('submits the reviewed values exactly once, including a ticked list field, and a second click does not resubmit', async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'submitted', applicationId: APP });
    expect(provider.submissions).toHaveLength(1);
    expect(provider.submissions[0]).toMatchObject({ url: FORM_URL, values: { diagnosis: 'Epithelioid sarcoma', goals: 'second opinion, clinical trial' } });
    expect((await store.get(APP))?.status).toBe('submitted');

    const again = await approve();
    expect(again.status).toBe(409);
    expect(provider.submissions).toHaveLength(1);
  });

  it('refuses a form whose live page changed after review: nothing is submitted and the draft is marked stale', async () => {
    provider.mutatePage(FORM_URL, [...page, { key: 'ssn', label: 'Social security number', type: 'text', required: true }]);
    const res = await approve();
    expect(res.status).toBe(409);
    expect((await res.json()).reasons).toEqual(['page_changed']);
    expect(provider.submissions).toHaveLength(0);
    expect((await store.get(APP))?.status).toBe('stale');
  });

  it('a gate refusal (field no longer ticked) submits nothing and leaves the draft reviewable', async () => {
    outreachStore.consentFields = ['diseaseName'];
    const res = await approve();
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain('unshared_field');
    expect(provider.submissions).toHaveLength(0);
    expect(provider.openSessions).toBe(0);
    expect((await store.get(APP))?.status).toBe('draft');
  });
});
