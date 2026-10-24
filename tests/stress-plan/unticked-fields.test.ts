import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/lib/case-docs';
import { MockBrowserProvider, TEST_APPLICATION_URL, defaultMockPages } from '@/lib/channels/mock-browser';
import { WebFormChannel } from '@/lib/channels/web-form';
import { KernelPlanWebForm } from '@/lib/plan/channels';
import { MemoryApplicationStore } from '@/lib/web-application/store';

const host = new URL(TEST_APPLICATION_URL).host;
beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('ANTHROPIC_API_KEY', ''); });
afterEach(() => vi.unstubAllEnvs());

function port(sharedFields: string[], record: Record<string, unknown>, webAllowlist = [host]) {
  const provider = new MockBrowserProvider(defaultMockPages);
  const applications = new MemoryApplicationStore();
  const p = new KernelPlanWebForm({
    channel: () => new WebFormChannel({ provider, guard: { allowlist: [], webAllowlist } }),
    applications: () => applications,
    context: async () => ({ caseRecord: record, sharedFields }),
    docStore: new MemoryDocumentStore(), newId: () => 'app-1', env: {},
  });
  return { p, provider, applications };
}

describe('draftFill only fills ticked fields (control: expected to pass)', () => {
  it('never fills an unticked field, even with HTML / unicode values on the record', async () => {
    const record = { diseaseName: 'Sarcoma <b>x</b> ‮evil', homeCity: 'Boston', homeState: 'MA', insurer: 'Plan', patientName: 'Pat' };
    const { p, provider } = port(['diseaseName'], record);
    const res = await p.draftFill({ caseId: 'c1', contactId: 'k1', url: TEST_APPLICATION_URL });
    expect(res.ok).toBe(true);
    const typed = provider.fillPreviews.flatMap(f => Object.values(f.values)).map(String);
    for (const v of ['Boston', 'MA', 'Plan', 'Pat']) expect(typed).not.toContain(v);
    expect(provider.submissions).toHaveLength(0);
  });
  it('refuses a non-allowlisted host without opening a browser', async () => {
    const { p, provider } = port(['diseaseName'], { diseaseName: 'x' }, ['example.org']);
    const res = await p.draftFill({ caseId: 'c1', contactId: 'k1', url: TEST_APPLICATION_URL });
    expect(res).toMatchObject({ ok: false, status: 'not_available' });
    expect(provider.openSessions).toBe(0);
  });
});
