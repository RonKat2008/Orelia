import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChainDb } from '../helpers/db/chain-db';
import { AI_DISCLOSURE_EMAIL, withDisclosure } from '@/lib/safety/disclosure';
import { checkOutbound, type GatedDraft } from '@/lib/safety/outbound-gate';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import { gatedWeb } from '../channels/web-helpers';

const kernel = vi.hoisted(() => ({
  probeApplicationForm: vi.fn(), draftFillWebForm: vi.fn(), submitGatedWebForm: vi.fn(),
}));
vi.mock('@/lib/channels/kernel-web', () => kernel);
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/db/client', () => ({ getDb: () => holder.db }));

const { createDefaultPlanWebForm, getWebFormChannel, KernelPlanWebForm, setWebFormChannelForTests } = await import('@/lib/plan/channels');

const URL_A = 'https://clinic.example.org/apply';
const ready = { status: 'ready' } as never;
const notReady = { status: 'unconfigured' } as never;
const filledOk = { filled: [], missing: [{ fieldKey: 'x' }], formFingerprint: 'fp', screenshot: null, usedDocIds: ['d1'] };

function port(over: { channel?: unknown; context?: () => Promise<unknown>; withDocStore?: boolean } = {}) {
  const applications = new MemoryApplicationStore();
  const p = new KernelPlanWebForm({
    channel: () => (over.channel ?? ready) as never,
    applications: () => applications,
    context: (over.context ?? (async () => ({ caseRecord: { diseaseName: 'x' }, sharedFields: ['diseaseName'] }))) as never,
    ...(over.withDocStore ? { docStore: {} as never } : {}),
  });
  return { p, applications };
}
const existing = (over: Partial<WebApplicationDraft> = {}): WebApplicationDraft => ({
  id: 'app-0', caseId: 'case-1', contactId: 'c1', url: URL_A, fields: [], missing: [], formFingerprint: 'fp', screenshot: null,
  sharedFields: [], sharedDocIds: [], status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: '2026-10-24T00:00:00.000Z', ...over,
} as WebApplicationDraft);

beforeEach(() => { Object.values(kernel).forEach((f) => f.mockReset()); });
afterEach(() => { setWebFormChannelForTests(undefined); vi.unstubAllEnvs(); });

describe('KernelPlanWebForm.probeForm', () => {
  it('is unavailable when the cloud browser is not configured', async () => {
    expect(await port({ channel: notReady }).p.probeForm(URL_A)).toMatchObject({ ok: false, status: 'not_available' });
    expect(kernel.probeApplicationForm).not.toHaveBeenCalled();
  });

  it('reports when the page has no form', async () => {
    kernel.probeApplicationForm.mockResolvedValue({ hasForm: false, url: URL_A, fields: [], formFingerprint: '' });
    const r = await port().p.probeForm(URL_A);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('No application form') });
  });

  it('returns copies of the probed fields', async () => {
    const fields = [{ key: 'a', label: 'A', type: 'text', required: true }];
    kernel.probeApplicationForm.mockResolvedValue({ hasForm: true, url: URL_A, fields, formFingerprint: 'fp' });
    const r = await port().p.probeForm(URL_A);
    expect(r).toMatchObject({ ok: true, formFingerprint: 'fp' });
    expect(r.ok && r.fields).not.toBe(fields);
  });

  it('hides provider error text behind a fixed sentence', async () => {
    kernel.probeApplicationForm.mockRejectedValue(new Error('secret provider detail'));
    const r = await port().p.probeForm(URL_A);
    expect(r).toEqual({ ok: false, status: 'not_available', reason: 'The online form could not be opened' });
  });
});

describe('KernelPlanWebForm.draftFill', () => {
  const input = { caseId: 'case-1', contactId: 'c1', url: URL_A };

  it('is unavailable without a cloud browser key', async () => {
    expect(await port({ channel: notReady }).p.draftFill(input)).toMatchObject({ ok: false });
  });

  it('reuses a live draft for the same case, contact and url instead of filling twice', async () => {
    const { p, applications } = port();
    await applications.save(existing({ status: 'submitted' }));
    const r = await p.draftFill(input);
    expect(r).toMatchObject({ ok: true, draft: { applicationId: 'app-0', status: 'submitted' } });
    expect(kernel.draftFillWebForm).not.toHaveBeenCalled();
  });

  it('does not reuse failed drafts or drafts for another contact or url', async () => {
    const { p, applications } = port();
    await applications.save(existing({ id: 'a1', status: 'failed' }));
    await applications.save(existing({ id: 'a2', contactId: 'other' }));
    await applications.save(existing({ id: 'a3', url: 'https://other.example.org/apply' }));
    kernel.draftFillWebForm.mockResolvedValue(filledOk);
    const r = await p.draftFill(input);
    expect(r.ok && r.draft.applicationId).not.toMatch(/^a[123]$/);
  });

  it('refuses to fill when consent context is missing', async () => {
    const r = await port({ context: async () => null }).p.draftFill(input);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('Choose what this contact may see') });
    expect(kernel.draftFillWebForm).not.toHaveBeenCalled();
  });

  it('hides provider error text when the browser fill throws', async () => {
    kernel.draftFillWebForm.mockRejectedValue(new Error('timeout at kernel'));
    const r = await port().p.draftFill(input);
    expect(r).toMatchObject({ ok: false, reason: 'The online form could not be opened' });
  });

  it('saves a draft, creates a review task and passes contact id and doc store only when present', async () => {
    kernel.draftFillWebForm.mockResolvedValue(filledOk);
    const { p, applications } = port({ withDocStore: true });
    const r = await p.draftFill(input);
    expect(r).toMatchObject({ ok: true, draft: { url: URL_A, status: 'draft', missingCount: 1 } });
    expect(applications.reviewTasks).toHaveLength(1);
    expect(kernel.draftFillWebForm.mock.calls[0][1]).toMatchObject({ contactId: 'c1', docStore: {} });

    kernel.draftFillWebForm.mockResolvedValue(filledOk);
    await port().p.draftFill({ ...input, contactId: null });
    const args = kernel.draftFillWebForm.mock.calls[1][1];
    expect(args).not.toHaveProperty('contactId');
    expect(args).not.toHaveProperty('docStore');
  });
});

describe('KernelPlanWebForm.submitGated', () => {
  it('refuses a payload that was not minted by the outbound gate', async () => {
    const r = await port().p.submitGated({ channel: 'web_form' } as unknown as GatedDraft);
    expect(r).toMatchObject({ ok: false, status: 'not_available' });
    expect(kernel.submitGatedWebForm).not.toHaveBeenCalled();
  });

  it('refuses a gated draft for a different channel', async () => {
    const result = checkOutbound({
      draft: { channel: 'email', address: 'test@example.com', body: withDisclosure('Hello about a second opinion.'), approvedAt: '2026-10-28T15:00:00Z' },
      consent: { sharedFields: ['diseaseName'] }, caseRecord: { diseaseName: 'rare disease' },
      contacts: [], allowlist: ['test@example.com'], now: '2026-10-28T16:00:00Z', mode: 'demo',
    });
    expect(AI_DISCLOSURE_EMAIL).toBeTruthy();
    if (!result.ok) throw new Error('fixture refused');
    expect(await port().p.submitGated(result.payload)).toMatchObject({ ok: false });
    expect(kernel.submitGatedWebForm).not.toHaveBeenCalled();
  });

  it('is unavailable when the browser is not ready', async () => {
    expect(await port({ channel: notReady }).p.submitGated(gatedWeb())).toMatchObject({ ok: false });
    expect(kernel.submitGatedWebForm).not.toHaveBeenCalled();
  });

  it('submits a gated web form through the browser channel', async () => {
    kernel.submitGatedWebForm.mockResolvedValue(undefined);
    expect(await port().p.submitGated(gatedWeb())).toEqual({ ok: true, status: 'submitted' });
    expect(kernel.submitGatedWebForm).toHaveBeenCalledTimes(1);
  });
});

describe('createDefaultPlanWebForm context', () => {
  const ctx = (id: string | null) =>
    createDefaultPlanWebForm().deps.context({ caseId: 'case-1', contactId: id });

  it('wires channel and application store lazily and memoises the browser channel', () => {
    vi.stubEnv('WAYFINDER_OFFLINE', '1');
    const form = createDefaultPlanWebForm();
    const a = form.deps.channel();
    expect(form.deps.channel()).toBe(a);
    expect(form.deps.applications()).toBeDefined();
  });

  it('has no context without a contact id', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    expect(await ctx(null)).toBeNull();
  });

  it('has no context without a database', async () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(await ctx('c1')).toBeNull();
  });

  it('returns the case record and the consented fields when consent was approved', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    const fake = createChainDb();
    holder.db = fake.db;
    fake.queue('select:consents', [{ approvedAt: new Date('2026-10-24T00:00:00Z'), sharedFields: ['diseaseName'] }]);
    fake.queue('select:cases', [{ diseaseName: 'Synthetic disease', homeCity: 'Austin' }]);
    const r = await ctx('c1');
    expect(r?.sharedFields).toEqual(['diseaseName']);
    expect(r?.caseRecord).toMatchObject({ diseaseName: 'Synthetic disease' });
  });

  it('has no context when consent is not approved or the case is gone', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    const fake = createChainDb();
    holder.db = fake.db;
    fake.queue('select:consents', [{ approvedAt: null, sharedFields: ['diseaseName'] }]);
    fake.queue('select:cases', [{ diseaseName: 'x' }]);
    expect(await ctx('c1')).toBeNull();
    fake.queue('select:consents', [{ approvedAt: new Date('2026-10-24T00:00:00Z'), sharedFields: [] }]);
    fake.queue('select:cases', []);
    expect(await ctx('c1')).toBeNull();
  });

  it('swallows database errors as a missing context', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://synthetic@localhost/synthetic');
    const fake = createChainDb();
    holder.db = fake.db;
    fake.queue('select:consents', new Error('db down'));
    expect(await ctx('c1')).toBeNull();
  });
});

describe('getWebFormChannel', () => {
  it('memoises the default channel and honours the test override', () => {
    vi.stubEnv('WAYFINDER_OFFLINE', '1');
    const a = getWebFormChannel();
    expect(getWebFormChannel()).toBe(a);
    const custom = { probeForm: vi.fn(), draftFill: vi.fn(), submitGated: vi.fn() };
    setWebFormChannelForTests(custom);
    expect(getWebFormChannel()).toBe(custom);
  });
});
