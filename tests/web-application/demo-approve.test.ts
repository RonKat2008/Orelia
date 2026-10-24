import { describe, expect, it, vi } from 'vitest';
import { approveApplication } from '@/lib/web-application/approve';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import { demoFormUrl } from '@/lib/outreach/demo-destinations';
import type { WebApplicationDraft } from '@/lib/web-application/types';

const DEMO = { WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: 'coord@agentmail.to', WAYFINDER_APP_BASE_URL: 'https://wayfinder.example.app', WAYFINDER_SESSION_SECRET: 's', NODE_ENV: 'production' };
const record = { diseaseName: 'vascular Ehlers-Danlos syndrome', homeState: 'OH', insurer: 'Fictional Plan' };

async function run(env: Record<string, string>, url: string, fields = [{ fieldKey: 'diagnosis', label: 'Diagnosis', type: 'text', value: record.diseaseName, source: { kind: 'consent', key: 'diseaseName' } }]) {
  const applications = new MemoryApplicationStore();
  const draft = { id: 'app-1', caseId: 'case-1', contactId: 'contact-1', url, fields, missing: [], formFingerprint: 'f1-x', screenshot: null, sharedFields: ['diseaseName'], sharedDocIds: [], status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: '2026-10-24T12:00:00.000Z' } as unknown as WebApplicationDraft;
  await applications.save(draft);
  const submit = vi.fn(async () => undefined);
  const result = await approveApplication('app-1', {}, {
    applications, submit, env, clock: () => new Date('2026-10-24T12:05:00Z'),
    outreach: {
      getCase: async () => record,
      consent: async () => ({ sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' }),
      contacts: async () => [{ id: 'contact-1', caseId: 'case-1', targetId: 'i-1', channel: 'voice', address: '+12025550199', state: 'drafted' }] as never,
    },
  });
  return { result, submit };
}

describe('web application approval in demo mode', () => {
  const demoUrl = demoFormUrl(DEMO, { caseId: 'case-1', applicationId: 'app-1', resourceKey: 'institution:i-1', realUrl: 'https://clinic.example.org/request' });

  it('passes the unchanged gate for the Wayfinder demo form and submits through the channel', async () => {
    const { result, submit } = await run(DEMO, demoUrl);
    expect(result).toMatchObject({ ok: true, status: 'submitted' });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('still refuses a real clinic form (not on the web allowlist) and unticked fields in demo mode', async () => {
    expect((await run(DEMO, 'https://clinic.example.org/request')).result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['not_allowlisted']) });
    const unticked = [{ fieldKey: 'insurer', label: 'Insurance', type: 'text', value: record.insurer, source: { kind: 'consent', key: 'insurer' } }];
    expect((await run(DEMO, demoUrl, unticked)).result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['unshared_field']) });
  });

  it('refuses the demo form host once demo mode is off', async () => {
    const { result, submit } = await run({ ...DEMO, WAYFINDER_DEMO_COORDINATORS: '' }, demoUrl);
    expect(result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['not_allowlisted']) });
    expect(submit).not.toHaveBeenCalled();
  });
});
