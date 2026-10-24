/**
 * Deterministic contact planner. Picks, per selected resource, which verified contact points to use and in what
 * order, from code-stamped contact_point.* evidence and the resource kind. It never invents a channel: every step
 * targets a contact point parsed from that resource's own evidence. A plan is a proposal; it never sends anything.
 */
import {
  MAX_PLAN_RESOURCES,
  type ContactPlan,
  type PlanChannel,
  type PlanResourceInput,
  type PlanStep,
  type ResourcePlan,
  type StepPurpose,
  type WaitFor,
} from './contract';
import { parsePlanContactPoints, type PlanContactOrigin, type PlanContactPoint } from './contact-points';
import { summarizePlan } from './summary';

export type RuleFamily = 'aid' | 'specialist' | 'trial' | 'advocacy';

const AID_KINDS = new Set(['financial_aid', 'travel_aid']);
const FOLLOW_UP_DAYS: Record<RuleFamily, number> = { aid: 3, specialist: 3, trial: 2, advocacy: 3 };

export const NO_CHANNEL_REASON = 'No verified email, phone or online form was found for this resource yet, so there is nothing to plan.';

/** Most to least preferred origin per family; unknown origins sort last. */
const ORIGIN_PREFERENCE: Record<RuleFamily, readonly PlanContactOrigin[]> = {
  specialist: [
    'referral_coordinator', 'second_opinion_program', 'new_patient_line', 'nurse_navigator', 'pathology_consult',
    'org_contact', 'nppes_location_phone', 'trial_contact', 'ctgov_central_contact',
    'referral_form', 'intake_form', 'application_form',
  ],
  trial: [
    'ctgov_central_contact', 'trial_contact', 'referral_coordinator', 'new_patient_line', 'nurse_navigator',
    'org_contact', 'second_opinion_program', 'pathology_consult', 'nppes_location_phone',
    'intake_form', 'referral_form', 'application_form',
  ],
  aid: [
    'org_contact', 'referral_coordinator', 'new_patient_line', 'nurse_navigator', 'second_opinion_program',
    'pathology_consult', 'trial_contact', 'nppes_location_phone', 'ctgov_central_contact',
    'application_form', 'intake_form', 'referral_form',
  ],
  advocacy: [
    'org_contact', 'nurse_navigator', 'referral_coordinator', 'new_patient_line', 'second_opinion_program',
    'pathology_consult', 'trial_contact', 'nppes_location_phone', 'ctgov_central_contact',
    'intake_form', 'application_form', 'referral_form',
  ],
};

const ORIGIN_LABEL: Record<PlanContactOrigin, string> = {
  referral_coordinator: 'referral coordinator',
  second_opinion_program: 'second-opinion program',
  new_patient_line: 'new-patient office',
  nurse_navigator: 'nurse navigator',
  pathology_consult: 'pathology consult service',
  trial_contact: 'study team',
  org_contact: 'main office',
  nppes_location_phone: 'practice office listed in the national provider registry',
  ctgov_central_contact: 'central study contact listed on ClinicalTrials.gov',
  demo_coordinator: 'Demo coordinator',
  application_form: 'online application form',
  referral_form: 'online referral form',
  intake_form: 'online intake form',
};

export function ruleFamily(r: Pick<PlanResourceInput, 'targetKind' | 'subKind'>): RuleFamily {
  if (r.targetKind === 'trial') return 'trial';
  if (r.targetKind === 'expert' || r.targetKind === 'institution') return 'specialist';
  return r.subKind && AID_KINDS.has(r.subKind) ? 'aid' : 'advocacy';
}

const resourceKeyOf = (r: Pick<PlanResourceInput, 'targetKind' | 'targetId'>) => `${r.targetKind}:${r.targetId}`;

function best(points: readonly PlanContactPoint[], channel: PlanChannel, family: RuleFamily): PlanContactPoint | undefined {
  const pref = ORIGIN_PREFERENCE[family];
  const rank = (o: PlanContactOrigin) => { const i = pref.indexOf(o); return i === -1 ? pref.length : i; };
  return points
    .map((p, i) => ({ p, i }))
    .filter(x => x.p.channel === channel)
    .sort((a, b) => rank(a.p.origin) - rank(b.p.origin) || a.i - b.i)[0]?.p;
}

interface StepDraft { cp: PlanContactPoint; purpose: StepPurpose; waitFor: WaitFor; reason: string }

/** targetRef + evidence ids for a contact point (web forms are targeted by URL, the others by evidence id). */
export function stepTarget(cp: PlanContactPoint): { targetRef: string; evidenceIds: string[] } {
  return { targetRef: cp.channel === 'web_form' ? cp.address : cp.evidenceId, evidenceIds: [cp.evidenceId] };
}

export function toSteps(drafts: readonly StepDraft[]): PlanStep[] {
  return drafts.map((d, i) => ({
    id: `s${i + 1}`,
    channel: d.cp.channel,
    order: i + 1,
    purpose: d.purpose,
    ...stepTarget(d.cp),
    reason: d.reason,
    waitFor: d.waitFor,
    enabled: true,
  }));
}

const days = (n: number) => `${n} business ${n === 1 ? 'day' : 'days'}`;
const label = (cp: PlanContactPoint) => ORIGIN_LABEL[cp.origin];

const reasons = {
  emailIntro: (cp: PlanContactPoint) =>
    `An email to the ${label(cp)} gives them your details in writing and lets them reply when they can. You review it before anything is sent.`,
  callIntro: (cp: PlanContactPoint) =>
    `A phone number for the ${label(cp)} is the only verified way to reach them, so a short introductory call comes first.`,
  callFollowUp: (cp: PlanContactPoint, n: number) =>
    `If there is no reply after ${days(n)}, a short call to the ${label(cp)} checks that the email arrived and asks what they need.`,
  formApply: (cp: PlanContactPoint) =>
    `They take requests through their ${label(cp)}, so filling it in is the most direct way to be considered.`,
  emailConfirm: (cp: PlanContactPoint, n: number) =>
    `If nothing comes back after ${days(n)}, a short email to the ${label(cp)} confirms the application arrived and asks about next steps.`,
};

interface Chosen { email?: PlanContactPoint; voice?: PlanContactPoint; form?: PlanContactPoint }

function aidPlan(c: Chosen, n: number): { rule: string; drafts: StepDraft[] } {
  if (c.form && c.email) return { rule: 'aid_form_then_email', drafts: [
    { cp: c.form, purpose: 'apply', waitFor: 'none', reason: reasons.formApply(c.form) },
    { cp: c.email, purpose: 'confirm', waitFor: `business_days:${n}`, reason: reasons.emailConfirm(c.email, n) },
  ] };
  if (c.form) return { rule: 'aid_form_only', drafts: [{ cp: c.form, purpose: 'apply', waitFor: 'none', reason: reasons.formApply(c.form) }] };
  return directPlan('aid', c, n);
}

/** Email first (call if no reply); without email, an online form (call if no reply); else a call. */
function directPlan(prefix: string, c: Chosen, n: number): { rule: string; drafts: StepDraft[] } {
  const first = c.email
    ? { kind: 'email', draft: { cp: c.email, purpose: 'intro' as const, waitFor: 'none' as const, reason: reasons.emailIntro(c.email) } }
    : c.form
      ? { kind: 'form', draft: { cp: c.form, purpose: 'apply' as const, waitFor: 'none' as const, reason: reasons.formApply(c.form) } }
      : undefined;
  if (!first) {
    return c.voice
      ? { rule: `${prefix}_call_only`, drafts: [{ cp: c.voice, purpose: 'intro', waitFor: 'none', reason: reasons.callIntro(c.voice) }] }
      : { rule: 'no_channel', drafts: [] };
  }
  if (!c.voice) return { rule: `${prefix}_${first.kind}_only`, drafts: [first.draft] };
  return { rule: `${prefix}_${first.kind}_then_call`, drafts: [
    first.draft,
    { cp: c.voice, purpose: 'follow_up', waitFor: `business_days:${n}`, reason: reasons.callFollowUp(c.voice, n) },
  ] };
}

export function planResource(input: PlanResourceInput): ResourcePlan {
  const family = ruleFamily(input);
  const points = parsePlanContactPoints(input.evidence);
  const chosen: Chosen = { email: best(points, 'email', family), voice: best(points, 'voice', family), form: best(points, 'web_form', family) };
  const n = FOLLOW_UP_DAYS[family];
  const { rule, drafts } = family === 'aid' ? aidPlan(chosen, n) : directPlan(family, chosen, n);
  return {
    resourceKey: resourceKeyOf(input),
    targetKind: input.targetKind,
    targetId: input.targetId,
    name: input.name.trim() || input.targetId,
    contactId: input.contactId,
    rule,
    steps: toSteps(drafts),
    unavailableReason: drafts.length === 0 ? NO_CHANNEL_REASON : null,
  };
}

/** First occurrence of each resourceKey, capped at MAX_PLAN_RESOURCES. */
export function selectPlanInputs(inputs: readonly PlanResourceInput[]): PlanResourceInput[] {
  const seen = new Set<string>();
  return inputs.filter(r => {
    const key = resourceKeyOf(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_PLAN_RESOURCES);
}

export function buildDeterministicPlan(caseId: string, inputs: readonly PlanResourceInput[], opts: { now: Date }): ContactPlan {
  const resources = selectPlanInputs(inputs).map(planResource);
  const at = opts.now.toISOString();
  return {
    caseId,
    version: 1,
    status: 'draft',
    source: 'rules',
    summary: summarizePlan(resources),
    resources,
    createdAt: at,
    updatedAt: at,
    approvedAt: null,
  };
}
