import { describe, expect, it, vi } from 'vitest';
import { materializeApprovedPlan, readySteps, type MaterializeDeps } from '@/lib/plan/materialize';
import { UnavailableWebFormChannel, type WebFormChannel } from '@/lib/plan/channels';
import type { ResourcePlan } from '@/lib/plan/contract';
import { makePlan, step } from './plan-fixture';

const approved = (resources: ResourcePlan[]) => makePlan('case-1', { status: 'approved', approvedAt: '2026-10-24T13:00:00.000Z', resources });
const resource = (key: string, steps: ResourcePlan['steps'], contactId: string | null = `contact-${key}`): ResourcePlan => ({
  resourceKey: `expert:${key}`, targetKind: 'expert', targetId: key, name: `Resource ${key}`, contactId, rule: 'r', unavailableReason: null, steps,
});

function deps(over: Partial<MaterializeDeps> = {}) {
  const createDraft = vi.fn(async (contactId: string) => ({ id: `draft-${contactId}` }));
  const d: MaterializeDeps = {
    contact: async id => ({ id, channel: 'email' }),
    createDraft,
    webForm: new UnavailableWebFormChannel('no browser'),
    ...over,
  };
  return { d, createDraft };
}

describe('readySteps', () => {
  it('is the enabled prefix up to the first business-day wait', () => {
    const r = resource('a', [
      step('s1', 1), step('s2', 2, { enabled: false }), step('s3', 3, { waitFor: 'reply', channel: 'web_form', targetRef: 'https://x.org/f' }),
      step('s4', 4, { purpose: 'follow_up', waitFor: 'business_days:3' }), step('s5', 5),
    ]);
    expect(readySteps(r).map(s => s.id)).toEqual(['s1', 's3']);
  });
});

describe('materializeApprovedPlan', () => {
  it('writes one outbox draft per contact for its ready email/voice step; later steps are scheduled', async () => {
    const { d, createDraft } = deps();
    const out = await materializeApprovedPlan(approved([resource('a', [step('s1', 1), step('s2', 2, { purpose: 'confirm', waitFor: 'business_days:3' })])]), d);
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { resourceKey: 'expert:a', stepId: 's1', channel: 'email', status: 'drafted', draftId: 'draft-contact-a' },
      { resourceKey: 'expert:a', stepId: 's2', channel: 'email', status: 'scheduled' },
    ]);
  });

  it('never drafts for a draft plan', async () => {
    const { d, createDraft } = deps();
    expect(await materializeApprovedPlan(makePlan('case-1'), d)).toEqual([]);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('a step on a channel the contact is not set up for is not drafted (the gate would refuse the address)', async () => {
    const { d, createDraft } = deps({ contact: async id => ({ id, channel: 'voice' }) });
    const out = await materializeApprovedPlan(approved([resource('a', [step('s1', 1)])]), d);
    expect(out[0]).toMatchObject({ status: 'channel_mismatch' });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('no contact row -> no_contact; a refused draft (no consent) -> blocked with the reason code only', async () => {
    const refusing = deps({ createDraft: async () => { throw Object.assign(new Error('x secret'), { reasons: ['consent_required'] }); } });
    const out = await materializeApprovedPlan(approved([resource('a', [step('s1', 1)], null), resource('b', [step('s1', 1)])]), refusing.d);
    expect(out.map(o => o.status)).toEqual(['no_contact', 'blocked']);
    expect(out[1].detail).toBe('consent_required');
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('a second ready email step for the same contact is left to the workflow', async () => {
    const { d, createDraft } = deps();
    const out = await materializeApprovedPlan(approved([resource('a', [step('s1', 1), step('s2', 2, { purpose: 'confirm' })])]), d);
    expect(out.map(o => o.status)).toEqual(['drafted', 'scheduled']);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('follow-up steps are covered by the walk-away follow-up plan, not drafted here', async () => {
    const { d, createDraft } = deps();
    const out = await materializeApprovedPlan(approved([resource('a', [step('s1', 1, { purpose: 'follow_up' })])]), d);
    expect(out[0]).toMatchObject({ status: 'follow_up_plan' });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it('web_form steps draft an application for review; unavailable forms are reported', async () => {
    const webForm: WebFormChannel = {
      probeForm: vi.fn(),
      draftFill: vi.fn(async ({ url }) => ({ ok: true as const, draft: { applicationId: 'app-1', url, status: 'draft' as const, missingCount: 1 } })),
      submitGated: vi.fn(),
    } as unknown as WebFormChannel;
    const form = step('s1', 1, { channel: 'web_form', purpose: 'apply', targetRef: 'https://aid.example.org/apply' });
    const ok = await materializeApprovedPlan(approved([resource('a', [form])]), deps({ webForm }).d);
    expect(ok[0]).toEqual({ resourceKey: 'expert:a', stepId: 's1', channel: 'web_form', status: 'application_drafted', applicationId: 'app-1' });
    expect(webForm.draftFill).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'case-1', contactId: 'contact-a', url: 'https://aid.example.org/apply', resourceKey: expect.any(String) }));
    expect(webForm.submitGated).not.toHaveBeenCalled();
    const none = await materializeApprovedPlan(approved([resource('a', [form])]), deps().d);
    expect(none[0]).toMatchObject({ status: 'not_available', detail: 'no browser' });
  });
});

describe('materializeApprovedPlan: verify steps', () => {
  const verify = (extra = {}) => step('s1', 1, { channel: 'voice', purpose: 'verify', ...extra });

  it('an opted-in verify step writes a verification request, never an outbox draft; the email still drafts', async () => {
    const createVerification = vi.fn(async () => ({ id: 'ver-1' }));
    const { d, createDraft } = deps({ createVerification });
    const out = await materializeApprovedPlan(approved([resource('a', [verify(), step('s2', 2)])]), d);
    expect(createVerification).toHaveBeenCalledWith({ caseId: 'case-1', resourceKey: 'expert:a' });
    expect(out).toEqual([
      { resourceKey: 'expert:a', stepId: 's1', channel: 'voice', status: 'verification_drafted', verificationId: 'ver-1' },
      { resourceKey: 'expert:a', stepId: 's2', channel: 'email', status: 'drafted', draftId: 'draft-contact-a' },
    ]);
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it('a disabled verify step (the default) does nothing; without the dep it is not_available; refusals keep only a code', async () => {
    const createVerification = vi.fn(async () => ({ id: 'ver-1' }));
    const off = await materializeApprovedPlan(approved([resource('a', [verify({ enabled: false }), step('s2', 2)])]), deps({ createVerification }).d);
    expect(createVerification).not.toHaveBeenCalled();
    expect(off.map(o => o.stepId)).toEqual(['s2']);
    const missing = await materializeApprovedPlan(approved([resource('a', [verify()])]), deps().d);
    expect(missing[0]).toMatchObject({ status: 'not_available' });
    const refused = await materializeApprovedPlan(approved([resource('a', [verify()])]), deps({
      createVerification: async () => { throw Object.assign(new Error('secret +16175550100'), { code: 'no_phone' }); },
    }).d);
    expect(refused[0]).toMatchObject({ status: 'blocked', detail: 'no_phone' });
    expect(JSON.stringify(refused)).not.toContain('secret');
  });
});
