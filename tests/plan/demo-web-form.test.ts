import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '@/lib/case-docs';
import { MockBrowserProvider, TEST_APPLICATION_URL, defaultMockPages } from '@/lib/channels/mock-browser';
import { WebFormChannel as BrowserWebFormChannel } from '@/lib/channels/web-form';
import { KernelPlanWebForm } from '@/lib/plan/channels';
import { applicationStepContext } from '@/components/plan/model';
import { demoFormUrl, webAllowlist } from '@/lib/outreach/demo-destinations';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { ContactPlan } from '@/lib/plan/contract';

const DEMO = { WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'coord@agentmail.to', WAYFINDER_APP_BASE_URL: 'https://wayfinder.example.app', WAYFINDER_SESSION_SECRET: 's' };
const REAL = 'https://clinic.example.org/request-an-appointment';
const KEY = 'institution:i-1';

beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('ANTHROPIC_API_KEY', ''); });
afterEach(() => vi.unstubAllEnvs());

function setup(env: Record<string, string>) {
  const demoUrl = demoFormUrl(env, { caseId: 'case-1', applicationId: 'app-1', resourceKey: KEY, realUrl: REAL });
  const page = defaultMockPages[TEST_APPLICATION_URL]!;
  const provider = new MockBrowserProvider({ [demoUrl]: page, [REAL]: page });
  const browser = new BrowserWebFormChannel({ provider, guard: { allowlist: [], webAllowlist: [...webAllowlist(env), 'clinic.example.org'] } });
  const applications = new MemoryApplicationStore();
  let n = 0;
  const port = new KernelPlanWebForm({
    channel: () => browser, applications: () => applications, env,
    context: async () => ({ caseRecord: { diseaseName: 'vascular Ehlers-Danlos syndrome', homeState: 'OH' }, sharedFields: ['diseaseName', 'homeState'] }),
    docStore: new MemoryDocumentStore(), now: () => new Date('2026-10-24T12:00:00Z'), newId: () => `app-${++n}`,
  });
  return { demoUrl, provider, applications, port };
}

describe('web form demo remap', () => {
  it('fills the Wayfinder demo intake form instead of the real form, idempotently, and never submits', async () => {
    const { demoUrl, provider, port } = setup(DEMO);
    const first = await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: REAL, resourceKey: KEY });
    expect(first).toMatchObject({ ok: true, draft: { url: demoUrl, status: 'draft' } });
    expect(provider.fillPreviews.map(p => p.url)).toEqual([demoUrl]);
    expect(provider.submissions).toHaveLength(0);
    const again = await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: REAL, resourceKey: KEY });
    expect(again).toEqual(first);
    expect(provider.fillPreviews).toHaveLength(1);
  });

  it('uses the real form URL when demo mode is off', async () => {
    const env = { WAYFINDER_APP_BASE_URL: 'https://wayfinder.example.app' };
    const { provider, port } = setup(env);
    const res = await port.draftFill({ caseId: 'case-1', contactId: 'contact-1', url: REAL, resourceKey: KEY });
    expect(res).toMatchObject({ ok: true, draft: { url: REAL } });
    expect(provider.fillPreviews.map(p => p.url)).toEqual([REAL]);
  });

  it('links the demo application back to the plan step whose real form it stands in for', () => {
    const { demoUrl } = setup(DEMO);
    const plan = {
      resources: [{ resourceKey: KEY, name: 'Clinic', contactId: 'contact-1', steps: [
        { id: 's1', channel: 'web_form', order: 1, purpose: 'apply', targetRef: REAL, reason: 'r', evidenceIds: ['e'], waitFor: 'none', enabled: true },
      ] }],
    } as unknown as ContactPlan;
    expect(applicationStepContext(plan, { contactId: 'contact-1', url: demoUrl })).toMatchObject({ resourceName: 'Clinic', channel: 'web_form' });
  });
});
