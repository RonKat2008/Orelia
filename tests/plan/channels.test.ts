import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/lib/case-docs';
import { MockBrowserProvider, TEST_APPLICATION_URL, defaultMockPages } from '@/lib/channels/mock-browser';
import { WebFormChannel as BrowserWebFormChannel } from '@/lib/channels/web-form';
import { KernelBrowserProvider } from '@/lib/channels/kernel-web';
import {
  getWebFormChannel, KernelPlanWebForm, setWebFormChannelForTests, UnavailableWebFormChannel, type WebFormChannel,
} from '@/lib/plan/channels';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import { gatedWeb } from '../channels/web-helpers';

const host = new URL(TEST_APPLICATION_URL).host;
const guard = { allowlist: [] as string[], webAllowlist: [host] };
const record = { diseaseName: 'Epithelioid sarcoma', homeCity: 'Boston', homeState: 'MA' };
const sharedFields = ['diseaseName', 'homeCity', 'homeState'];

beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('ANTHROPIC_API_KEY', ''); });
afterEach(() => { vi.unstubAllEnvs(); setWebFormChannelForTests(undefined); });

function setup(over: { provider?: MockBrowserProvider; context?: KernelPlanWebForm['deps']['context'] } = {}) {
  const provider = over.provider ?? new MockBrowserProvider(defaultMockPages);
  const browser = new BrowserWebFormChannel({ provider, guard });
  const applications = new MemoryApplicationStore();
  let n = 0;
  const port = new KernelPlanWebForm({
    channel: () => browser,
    applications: () => applications,
    context: over.context ?? (async () => ({ caseRecord: record, sharedFields })),
    docStore: new MemoryDocumentStore(),
    now: () => new Date('2026-10-24T12:00:00Z'),
    newId: () => `app-${++n}`,
  });
  return { provider, applications, port };
}

describe('plan web form port: defaults', () => {
  it('the unavailable channel reports not_available without any network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ch = new UnavailableWebFormChannel();
    expect(await ch.probeForm('https://example.org/apply')).toMatchObject({ ok: false, status: 'not_available' });
    expect(await ch.draftFill({ caseId: 'c', contactId: null, url: 'https://example.org/apply' })).toMatchObject({ ok: false, status: 'not_available' });
    expect(await ch.submitGated({} as never)).toMatchObject({ ok: false, status: 'not_available' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('default channel is the Kernel adapter; unconfigured Kernel answers not_available with no I/O', async () => {
    vi.stubEnv('WAYFINDER_OFFLINE', '');
    vi.stubEnv('KERNEL_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ch = getWebFormChannel();
    expect(ch).toBeInstanceOf(KernelPlanWebForm);
    expect(await ch.probeForm('https://example.org/apply')).toMatchObject({ ok: false, status: 'not_available' });
    expect(await ch.draftFill({ caseId: 'c', contactId: 'k', url: 'https://example.org/apply' })).toMatchObject({ ok: false, status: 'not_available' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('allows injection and clearing', async () => {
    const fake: WebFormChannel = new UnavailableWebFormChannel('custom reason');
    setWebFormChannelForTests(fake);
    expect(getWebFormChannel()).toBe(fake);
    expect(await fake.probeForm('x')).toEqual({ ok: false, status: 'not_available', reason: 'custom reason' });
    setWebFormChannelForTests(undefined);
    expect(getWebFormChannel()).not.toBe(fake);
  });
});

describe('KernelPlanWebForm', () => {
  it('probeForm reports the form fields and never fills or submits', async () => {
    const { provider, port } = setup();
    const probe = await port.probeForm(TEST_APPLICATION_URL);
    expect(probe.ok).toBe(true);
    if (!probe.ok) return;
    expect(probe.fields.map(f => f.key)).toContain('diagnosis');
    expect(probe.formFingerprint).toMatch(/^f1-/);
    expect(provider.submissions).toHaveLength(0);
    expect(provider.fillPreviews).toHaveLength(0);
  });

  it('probeForm on an off-allowlist host or a page without a form is not_available', async () => {
    const { port } = setup({ provider: new MockBrowserProvider({ [TEST_APPLICATION_URL]: { fields: [] } }) });
    expect(await port.probeForm('https://evil.example/apply')).toMatchObject({ ok: false, status: 'not_available' });
    expect(await port.probeForm(TEST_APPLICATION_URL)).toMatchObject({ ok: false, status: 'not_available' });
  });

  it('draftFill persists a draft with screenshot, consented-only values and a review task; never submits', async () => {
    const { provider, applications, port } = setup();
    const res = await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: TEST_APPLICATION_URL });
    expect(res).toMatchObject({ ok: true, draft: { applicationId: 'app-1', status: 'draft' } });
    const saved = await applications.get('app-1');
    expect(saved).toMatchObject({ caseId: 'case-1', contactId: 'contact-1', url: TEST_APPLICATION_URL, status: 'draft', sharedFields });
    expect(saved!.screenshot!.length).toBeGreaterThan(10);
    for (const f of saved!.fields) {
      if (f.source.kind === 'consent') expect(sharedFields).toContain(f.source.key);
    }
    expect(saved!.fields.some(f => f.source.kind === 'disclosure')).toBe(true);
    expect(saved!.missing.some(m => m.reason === 'medical_question')).toBe(true);
    expect(applications.reviewTasks).toHaveLength(1);
    expect(provider.submissions).toHaveLength(0);
  });

  it('draftFill is idempotent per case + contact + url (no duplicate drafts on re-run)', async () => {
    const { applications, port } = setup();
    await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: TEST_APPLICATION_URL });
    const again = await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: TEST_APPLICATION_URL });
    expect(again).toMatchObject({ ok: true, draft: { applicationId: 'app-1' } });
    expect((await applications.listByCase('case-1'))).toHaveLength(1);
  });

  it('draftFill without consent for the contact is not_available and opens no browser', async () => {
    const { provider, port } = setup({ context: async () => null });
    expect(await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: TEST_APPLICATION_URL }))
      .toMatchObject({ ok: false, status: 'not_available' });
    expect(provider.openSessions).toBe(0);
  });

  it('an unconfigured Kernel provider is not_available before touching anything', async () => {
    const browser = new BrowserWebFormChannel({ provider: new KernelBrowserProvider({}), guard });
    const context = vi.fn(async () => ({ caseRecord: record, sharedFields }));
    const port = new KernelPlanWebForm({ channel: () => browser, applications: () => new MemoryApplicationStore(), context });
    expect(await port.draftFill({ caseId: 'c', contactId: 'k', url: TEST_APPLICATION_URL })).toMatchObject({ ok: false, status: 'not_available' });
    expect(context).not.toHaveBeenCalled();
  });

  it('submitGated accepts only a GatedDraft and submits through the browser channel', async () => {
    const { provider, port } = setup({
      provider: new MockBrowserProvider({ 'http://localhost:3000/dev/test-application': { fields: [
        { key: 'fullName', label: 'Full name', type: 'text', required: true },
        { key: 'notes', label: 'Anything else you want to tell us', type: 'textarea', required: false },
        { key: 'documents', label: 'Documents', type: 'file', required: false },
        { key: 'consentConfirm', label: 'I authorize this application', type: 'checkbox', required: true },
      ] } }),
    });
    expect(await port.submitGated({ channel: 'web_form' } as never)).toMatchObject({ ok: false, status: 'not_available' });
    expect(provider.submissions).toHaveLength(0);
    expect(await port.submitGated(gatedWeb())).toEqual({ ok: true, status: 'submitted' });
    expect(provider.submissions).toHaveLength(1);
  });
});
