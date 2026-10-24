import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactPlanSchema, MAX_PLAN_RESOURCES, type ResourcePlan } from '@/lib/plan/contract';
import { buildContactPlan, buildDeterministicPlan, NO_CHANNEL_REASON, parsePlanContactPoints, validatePlanAgainstInputs, webFormEvidence } from '@/lib/plan';
import { demoCoordinatorEvidence } from '@/lib/plan/contact-points';
import { emailEv, formEv, NOW, phoneEv, plainEv, resource } from './planner-fixtures';

const E = () => emailEv('org_contact', 'info@aid.example.org');
const P = () => phoneEv('org_contact', '+16175550100');
const F = () => formEv('application_form', 'https://aid.example.org/apply');

const only = (r: Parameters<typeof buildDeterministicPlan>[1][number]): ResourcePlan => buildDeterministicPlan('case-1', [r], { now: NOW }).resources[0];
const shape = (rp: ResourcePlan) => rp.steps.map(s => `${s.channel}:${s.purpose}:${s.waitFor}`);

describe('parsePlanContactPoints', () => {
  it('reads code-stamped email, voice and web form rows with their evidence ids', () => {
    const ev = [E(), P(), F(), plainEv('x1')];
    const cps = parsePlanContactPoints(ev);
    expect(cps.map(c => [c.channel, c.evidenceId])).toEqual([['email', ev[0].id], ['voice', ev[1].id], ['web_form', ev[2].id]]);
    expect(cps[2].address).toBe('https://aid.example.org/apply');
  });

  it('never mines free-text claims or accepts malformed web form rows', () => {
    const rows = [
      { id: 'a', claimType: 'org_contact', claim: 'Email info@aid.example.org', sourceUrl: 'https://example.org', sourceKind: 'exa' as const },
      { id: 'b', claimType: 'contact_point.web_form.application_form', claim: 'apply at https://x.example.org', sourceUrl: 'https://example.org', sourceKind: 'exa' as const },
      { id: 'c', claimType: 'contact_point.web_form.application_form', claim: 'javascript:alert(1)', sourceUrl: 'https://example.org', sourceKind: 'exa' as const },
      { id: 'd', claimType: 'contact_point.web_form.made_up', claim: 'https://x.example.org', sourceUrl: 'https://example.org', sourceKind: 'exa' as const },
      { id: 'e', claimType: 'contact_point.web_form.application_form', claim: 'https://x.example.org', sourceUrl: 'https://example.org', sourceKind: 'pubmed' as const },
    ];
    expect(parsePlanContactPoints(rows)).toEqual([]);
  });

  it('webFormEvidence is code-only and rejects non-http urls', () => {
    expect(webFormEvidence({ origin: 'intake_form', url: 'https://c.example.org/intake', sourceUrl: 'https://c.example.org', sourceKind: 'exa' }, '2026-10-01T00:00:00.000Z'))
      .toMatchObject({ id: 'contact_point:intake_form:https://c.example.org/intake', claimType: 'contact_point.web_form.intake_form', claim: 'https://c.example.org/intake' });
    expect(webFormEvidence({ origin: 'intake_form', url: 'ftp://c.example.org', sourceUrl: 'https://c.example.org', sourceKind: 'exa' }, '2026-10-01T00:00:00.000Z')).toBeNull();
  });
});

describe('financial / travel aid rules', () => {
  it('form + email: apply online, then confirm by email after 3 business days', () => {
    const r = only(resource('organization', 'o1', [E(), F()], 'financial_aid'));
    expect(r.rule).toBe('aid_form_then_email');
    expect(shape(r)).toEqual(['web_form:apply:none', 'email:confirm:business_days:3']);
    expect(r.steps[0].targetRef).toBe('https://aid.example.org/apply');
    expect(r.steps[0].evidenceIds).toEqual([F().id]);
    expect(r.steps[1].targetRef).toBe(E().id);
  });

  it('form without email: just apply (phone is not used)', () => {
    const r = only(resource('organization', 'o1', [F(), P()], 'travel_aid'));
    expect(r.rule).toBe('aid_form_only');
    expect(shape(r)).toEqual(['web_form:apply:none']);
  });

  it('no form: email intro then call if no reply', () => {
    const r = only(resource('organization', 'o1', [P(), E()], 'financial_aid'));
    expect(r.rule).toBe('aid_email_then_call');
    expect(shape(r)).toEqual(['email:intro:none', 'voice:follow_up:business_days:3']);
    expect(r.steps[1].targetRef).toBe(P().id);
  });

  it('email only / phone only', () => {
    expect(shape(only(resource('organization', 'o1', [E()], 'financial_aid')))).toEqual(['email:intro:none']);
    const call = only(resource('organization', 'o1', [P()], 'travel_aid'));
    expect(call.rule).toBe('aid_call_only');
    expect(shape(call)).toEqual(['voice:intro:none']);
  });
});

describe('specialist rules (expert / institution)', () => {
  const refE = emailEv('referral_coordinator', 'referrals@center.example.org');
  const refP = phoneEv('referral_coordinator', '+16175550111');

  it('email + phone: email intro, call only if no reply after 3 business days', () => {
    const r = only(resource('expert', 'e1', [refE, refP]));
    expect(r.rule).toBe('specialist_email_then_call_verify');
    expect(shape(r)).toEqual(['voice:verify:none', 'email:intro:none', 'voice:follow_up:business_days:3']);
    expect(r.steps.map(s => s.id)).toEqual(['s1', 's2', 's3']);
    expect(r.steps.map(s => s.order)).toEqual([1, 2, 3]);
    // The verification call is opt-in; the other steps stay enabled.
    expect(r.steps.map(s => s.enabled)).toEqual([false, true, true]);
    expect(r.steps[0].targetRef).toBe(refP.id);
    expect(r.steps[0].reason).toMatch(/Only the diagnosis name is shared/);
  });

  it('email only / phone only', () => {
    expect(only(resource('institution', 'i1', [refE])).rule).toBe('specialist_email_only');
    const call = only(resource('institution', 'i1', [refP], 'cancer_center'));
    expect(call.rule).toBe('specialist_call_only_verify');
    expect(shape(call)).toEqual(['voice:verify:none', 'voice:intro:none']);
  });

  it('prefers referral coordinator > second opinion > new patient line > navigator > org contact', () => {
    const ev = [
      emailEv('org_contact', 'info@center.example.org'),
      emailEv('nurse_navigator', 'navigation@center.example.org'),
      emailEv('new_patient_line', 'appointments@center.example.org'),
      emailEv('second_opinion_program', 'secondopinion@center.example.org'),
      phoneEv('nppes_location_phone', '+16175550199'),
      phoneEv('new_patient_line', '+16175550122'),
    ];
    const r = only(resource('institution', 'i1', ev));
    expect(r.steps[0]).toMatchObject({ purpose: 'verify', targetRef: ev[5].id });
    expect(r.steps[1].targetRef).toBe(ev[3].id);
    expect(r.steps[2].targetRef).toBe(ev[5].id);
    const withRef = only(resource('institution', 'i1', [...ev, refE]));
    expect(withRef.steps[1].targetRef).toBe(refE.id);
  });

  it('a referral form is used only when there is no email (form, then call if no reply)', () => {
    const form = formEv('referral_form', 'https://center.example.org/refer');
    expect(only(resource('institution', 'i1', [refE, form, refP])).rule).toBe('specialist_email_then_call_verify');
    const r = only(resource('institution', 'i1', [form, refP]));
    expect(r.rule).toBe('specialist_form_then_call_verify');
    expect(shape(r)).toEqual(['voice:verify:none', 'web_form:apply:none', 'voice:follow_up:business_days:3']);
    expect(only(resource('institution', 'i1', [form])).rule).toBe('specialist_form_only');
  });
});

describe('verify step', () => {
  it('is only added for specialists with a verified phone, never for trials / aid / advocacy', () => {
    const p = phoneEv('new_patient_line', '+16175550133');
    expect(only(resource('expert', 'e9', [p])).steps.some(s => s.purpose === 'verify')).toBe(true);
    expect(only(resource('expert', 'e9', [emailEv('referral_coordinator', 'referrals@center.example.org')])).steps.some(s => s.purpose === 'verify')).toBe(false);
    expect(only(resource('trial', 't9', [phoneEv('ctgov_central_contact', '+16175550134')])).steps.some(s => s.purpose === 'verify')).toBe(false);
    expect(only(resource('organization', 'o9', [P()], 'financial_aid')).steps.some(s => s.purpose === 'verify')).toBe(false);
  });

  it('a plan with a verify step is schema-valid and the summary ignores the disabled verify step', () => {
    const plan = buildDeterministicPlan('case-1', [resource('expert', 'e1', [phoneEv('referral_coordinator', '+16175550111')])], { now: NOW });
    expect(contactPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.summary).toBe('1 resource: 1 call.');
  });
});

describe('trial rules', () => {
  const tE = emailEv('ctgov_central_contact', 'trials@sponsor.example.org', 'https://clinicaltrials.gov/study/NCT00000001');
  const tP = phoneEv('ctgov_central_contact', '+16175550133', 'https://clinicaltrials.gov/study/NCT00000001');

  it('central contact email + phone: email, then call after 2 business days', () => {
    const r = only(resource('trial', 'NCT00000001', [tE, tP]));
    expect(r.rule).toBe('trial_email_then_call');
    expect(shape(r)).toEqual(['email:intro:none', 'voice:follow_up:business_days:2']);
  });

  it('single channel when only one exists', () => {
    expect(shape(only(resource('trial', 'NCT1', [tE])))).toEqual(['email:intro:none']);
    expect(shape(only(resource('trial', 'NCT1', [tP])))).toEqual(['voice:intro:none']);
  });

  it('prefers the registry central contact over a page trial contact', () => {
    const page = emailEv('trial_contact', 'studycoordinator@site.example.org');
    expect(only(resource('trial', 'NCT1', [page, tE])).steps[0].targetRef).toBe(tE.id);
  });
});

describe('advocacy and fallbacks', () => {
  it('advocacy: email intro, call fallback after 3 business days', () => {
    const r = only(resource('organization', 'o2', [E(), P()], 'advocacy'));
    expect(r.rule).toBe('advocacy_email_then_call');
    expect(shape(r)).toEqual(['email:intro:none', 'voice:follow_up:business_days:3']);
  });

  it('organization with unknown kind follows advocacy rules', () => {
    expect(only(resource('organization', 'o2', [E()])).rule).toBe('advocacy_email_only');
  });

  it('no contact points: no_channel with a human-readable reason', () => {
    const r = only(resource('expert', 'e9', [plainEv('x1')]));
    expect(r.rule).toBe('no_channel');
    expect(r.steps).toEqual([]);
    expect(r.unavailableReason).toMatch(/no verified email, phone or online form/i);
  });
});

describe('buildDeterministicPlan', () => {
  it('produces a valid draft plan with a counted summary', () => {
    const plan = buildDeterministicPlan('case-1', [
      resource('organization', 'o1', [E(), F()], 'financial_aid'),
      resource('expert', 'e1', [emailEv('referral_coordinator', 'referrals@c.example.org'), phoneEv('referral_coordinator', '+16175550144')]),
      resource('trial', 't1', [plainEv('x')]),
    ], { now: NOW });
    expect(contactPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan).toMatchObject({ caseId: 'case-1', status: 'draft', source: 'rules', version: 1, approvedAt: null, createdAt: NOW.toISOString() });
    expect(plan.summary).toBe('3 resources: 1 email, 1 online application, 1 email if no reply, 1 call if no reply. 1 has no contact channel yet.');
  });

  it('every step cites the contact point it targets and a plain-language reason', () => {
    const plan = buildDeterministicPlan('c', [resource('expert', 'e1', [emailEv('referral_coordinator', 'referrals@c.example.org'), phoneEv('new_patient_line', '+16175550144')])], { now: NOW });
    for (const s of plan.resources[0].steps) {
      expect(s.evidenceIds).toContain(s.targetRef);
      expect(s.reason.length).toBeGreaterThan(10);
    }
  });

  it(`caps at ${MAX_PLAN_RESOURCES} resources and dedupes by resourceKey`, () => {
    const many = Array.from({ length: 7 }, (_, i) => resource('expert', `e${i}`, [E()]));
    const plan = buildDeterministicPlan('c', [many[0], many[0], ...many.slice(1)], { now: NOW });
    expect(plan.resources.map(r => r.resourceKey)).toEqual(['expert:e0', 'expert:e1', 'expert:e2', 'expert:e3', 'expert:e4']);
  });

  it('empty selection', () => {
    expect(buildDeterministicPlan('c', [], { now: NOW }).summary).toBe('No resources selected yet.');
  });

  it('buildContactPlan without llm returns the deterministic plan', async () => {
    const input = [resource('organization', 'o1', [E()], 'advocacy')];
    expect(await buildContactPlan('c', input, { now: NOW })).toEqual(buildDeterministicPlan('c', input, { now: NOW }));
  });
});

describe('demo coordinator mode', () => {
  const demo = (address: string, contactId = 'contact-d1') => demoCoordinatorEvidence(contactId, address);
  const envOn = () => {
    vi.stubEnv('WAYFINDER_DEMO_COORDINATORS', '1');
    vi.stubEnv('OUTBOUND_ALLOWLIST', 'demo-a@example.org');
    vi.stubEnv('AGENTMAIL_SENDER_INBOX_ID', 'sender@example.org');
  };
  afterEach(() => vi.unstubAllEnvs());

  it('gives a doorless resource an email step to the demo coordinator, labelled "Demo coordinator"', () => {
    envOn();
    const rp = only(resource('organization', 'd1', [demo('demo-a@example.org')], 'advocacy'));
    expect(shape(rp)).toEqual(['email:intro:none']);
    expect(rp.steps[0].reason).toContain('Demo coordinator');
    expect(rp.steps[0].evidenceIds).toEqual(['contact_point:demo_coordinator:contact-d1']);
    expect(rp.unavailableReason).toBeNull();
  });

  it('plans from the REAL contact points in demo mode, exactly as with the mode off (adaptive mix, combinations)', () => {
    const inputs = [
      resource('organization', 'a1', [E(), F()], 'financial_aid'),
      resource('trial', 't1', [P()]),
      resource('institution', 'i1', [P(), F()]),
    ];
    const off = buildDeterministicPlan('case-1', inputs, { now: NOW });
    envOn();
    const on = buildDeterministicPlan('case-1', inputs, { now: NOW });
    expect(on.resources).toEqual(off.resources);
    const channels = new Set(on.resources.flatMap(r => r.steps.filter(st => st.enabled).map(st => st.channel)));
    expect(channels).toEqual(new Set(['email', 'voice', 'web_form']));
    expect(on.resources.map(r => r.rule)).toEqual(['aid_form_then_email', 'trial_call_only', 'specialist_form_then_call_verify']);
    expect(validatePlanAgainstInputs(on, inputs)).toEqual([]);
  });

  it('prefers a real email over a legacy demo coordinator row', () => {
    envOn();
    const input = resource('organization', 'd1', [E(), P(), demo('demo-a@example.org')], 'advocacy');
    expect(only(input).steps[0].evidenceIds).not.toEqual(['contact_point:demo_coordinator:contact-d1']);
  });

  it('ignores the demo row when the mode is off or the address is not an allowlisted demo inbox', () => {
    const ev = demo('demo-a@example.org');
    expect(only(resource('organization', 'd1', [ev], 'advocacy')).unavailableReason).toBe(NO_CHANNEL_REASON);
    envOn();
    expect(only(resource('organization', 'd1', [demo('other@hospital.example')], 'advocacy')).unavailableReason).toBe(NO_CHANNEL_REASON);
  });
});
