import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRunStore } from '@/lib/agents/run-store';
import { MemoryDocumentStore } from '@/lib/case-docs';
import { MockBrowserProvider, TEST_APPLICATION_URL, defaultMockPages } from '@/lib/channels/mock-browser';
import { ChannelError } from '@/lib/channels/types';
import { WebFormChannel } from '@/lib/channels/web-form';
import { draftFillWebForm, probeApplicationForm, submitGatedWebForm } from '@/lib/channels/kernel-web';
import { checkOutbound } from '@/lib/safety/outbound-gate';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { forgedWeb } from './web-helpers';

const host = new URL(TEST_APPLICATION_URL).host;
const guard = { allowlist: [] as string[], webAllowlist: [host] };
const record = { patientName: 'Pat Example', diseaseName: 'Epithelioid sarcoma', homeCity: 'Boston', homeState: 'MA' };
const sharedFields = ['patientName', 'diseaseName', 'homeCity', 'homeState'];

beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); vi.stubEnv('ANTHROPIC_API_KEY', ''); });
afterEach(() => vi.unstubAllEnvs());
const setup = () => { const provider = new MockBrowserProvider(defaultMockPages); return { provider, channel: new WebFormChannel({ provider, guard }) }; };

describe('kernel-web typed API', () => {
  it('probes a form without filling or submitting', async () => {
    const { provider, channel } = setup();
    const r = await probeApplicationForm(channel, TEST_APPLICATION_URL);
    expect(r.hasForm).toBe(true);
    expect(r.fields.length).toBeGreaterThan(3);
    expect(r.formFingerprint).toMatch(/^f1-/);
    expect(provider.submissions).toHaveLength(0);
  });
  it('reports hasForm=false for a page with no controls and refuses off-allowlist hosts', async () => {
    const provider = new MockBrowserProvider({ [TEST_APPLICATION_URL]: { fields: [] } });
    const channel = new WebFormChannel({ provider, guard });
    expect((await probeApplicationForm(channel, TEST_APPLICATION_URL)).hasForm).toBe(false);
    await expect(probeApplicationForm(channel, 'https://evil.example/apply')).rejects.toBeInstanceOf(ChannelError);
  });
  it('draft-fills without submitting, then submits only a gated draft', async () => {
    const { provider, channel } = setup();
    const draft = await draftFillWebForm(channel, {
      url: TEST_APPLICATION_URL, caseId: 'case-1', caseRecord: record, sharedFields,
      docStore: new MemoryDocumentStore(), runStore: new MemoryRunStore(),
    });
    expect(provider.submissions).toHaveLength(0);
    expect(draft.screenshot.length).toBeGreaterThan(10);
    expect(draft.filled.some(f => f.source.kind === 'disclosure')).toBe(true);
    expect(draft.missing.some(m => m.reason === 'medical_question')).toBe(true);
    expect(draft.safetyDraft.channel).toBe('web_form');

    const gate = checkOutbound({
      draft: { ...draft.safetyDraft, approvedAt: '2026-10-28T15:00:00Z' },
      consent: { sharedFields, sharedDocIds: [] }, caseRecord: record, contacts: [], allowlist: [],
      webAllowlist: [host], now: '2026-10-28T16:00:00Z', mode: 'demo',
    });
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    await submitGatedWebForm(channel, gate.payload);
    expect(provider.submissions).toHaveLength(1);
    expect(JSON.stringify(provider.submissions[0]!.values)).toContain(AI_DISCLOSURE_EMAIL);
  });
  it('refuses a forged draft', async () => {
    const { provider, channel } = setup();
    await expect(submitGatedWebForm(channel, forgedWeb())).rejects.toBeInstanceOf(ChannelError);
    expect(provider.submissions).toHaveLength(0);
  });
});
