/**
 * Deterministic policy: which actions a ResourceAgent MAY take right now. The model never widens this set; it only
 * picks one of these (lib/agents/factory/decide.ts), and anything else falls back to defaultDecision().
 * Pure: no I/O, so every rule is unit-tested.
 */
import { addBusinessDays } from '../../workflows/business-days';
import { scaleDeadline } from '../../workflows/clock';
import type { PlanStep, ResourcePlan } from '../../plan/contract';
import type { AgentAction, AgentChannel, AgentDecision, AgentGoal, ResourceAgent } from './types';

export const DEFAULT_SWITCH_BUSINESS_DAYS = 3;
/** How long a waiting agent sleeps before the sweep looks again when nothing has a deadline (ms, real time). */
export const IDLE_RECHECK_MS = 6 * 60 * 60 * 1000;
const REQUEST_KINDS = new Set(['records', 'slides']);
const ESCALATE_KINDS = new Set(['unclear', 'redirect', 'call', 'referral']);
const FINISHED_STATES = new Set(['appointment_booked', 'connected', 'declined']);
const ENGAGED_STATES = new Set(['replied', 'task_open', 'records_sent']);

export function goalFor(r: Pick<ResourcePlan, 'targetKind' | 'rule'>): AgentGoal {
  if (r.targetKind === 'trial') return 'trial_screening';
  if (r.targetKind === 'organization') return /aid/.test(r.rule) ? 'aid_application' : 'membership';
  return 'appointment';
}

const CHANNEL_OF: Record<PlanStep['channel'], AgentChannel> = { email: 'email', voice: 'call', web_form: 'web' };

/** Enabled, non-verify plan steps in order, one entry per channel change. */
export function strategySteps(r: Pick<ResourcePlan, 'steps'>): PlanStep[] {
  const steps = [...r.steps].filter(s => s.enabled && s.purpose !== 'verify').sort((a, b) => a.order - b.order);
  return steps.filter((s, i) => i === 0 || CHANNEL_OF[s.channel] !== CHANNEL_OF[steps[i - 1].channel]);
}

export function strategyFor(r: Pick<ResourcePlan, 'steps'>): AgentChannel[] {
  return strategySteps(r).map(s => CHANNEL_OF[s.channel]);
}

export interface ObservedMessage { id: string; direction: 'inbound' | 'outbound'; channel: 'email' | 'voice'; approvedAt: string | null; sentAt: string | null; receivedAt: string | null; classification: string | null; from?: string | null; body?: string }
export interface ObservedCall { id: string; approvedAt: string | null; startedAt: string | null; endedAt: string | null; outcome: string | null; transcript: string | null }
export interface ObservedApplication { id: string; url: string; status: string; approvedAt: string | null; submittedAt: string | null }
export interface ObservedTask { id: string; kind: string; title: string | null; status: string }

/** Everything the agent may see, loaded ONLY for its own contact / resource. */
export interface Observation {
  now: Date;
  /** Clock scale (demo time compression) applied to business-day deadlines. */
  scale: number;
  tz?: string;
  contact: { id: string; channel: 'email' | 'voice'; state: string; firstSentAt: string | null; nextFollowUpAt: string | null; followUpsSent: number } | null;
  consent: { sharedFields: string[]; approved: boolean };
  plan: ResourcePlan | null;
  messages: ObservedMessage[];
  calls: ObservedCall[];
  applications: ObservedApplication[];
  tasks: ObservedTask[];
  /** Verification calls prepared for this resource that wait for the patient. */
  pendingVerifications: number;
}

export interface Allowed {
  actions: AgentAction[];
  /** Short code-written explanation per action (shown to the model and in events). */
  why: Partial<Record<AgentAction, string>>;
  currentChannel: AgentChannel | null;
  currentStep: PlanStep | null;
  nextStep: PlanStep | null;
  /** When the current channel is out of time and the next one may start (null: no switch deadline). */
  switchAt: Date | null;
  pendingApproval: number;
}

export function pendingApprovals(o: Observation): number {
  const msgs = o.messages.filter(m => m.direction === 'outbound' && !m.approvedAt && !m.sentAt).length;
  const calls = o.calls.filter(c => !c.approvedAt && !c.startedAt).length;
  const apps = o.applications.filter(a => !a.approvedAt && !a.submittedAt && a.status !== 'not_available' && a.status !== 'failed').length;
  return msgs + calls + apps + o.pendingVerifications;
}

function hasOutboundOn(o: Observation, ch: AgentChannel, step: PlanStep | null): boolean {
  if (ch === 'email') return o.messages.some(m => m.direction === 'outbound' && m.channel === 'email');
  if (ch === 'call') return o.calls.length > 0 || o.messages.some(m => m.direction === 'outbound' && m.channel === 'voice') || o.pendingVerifications > 0;
  return o.applications.some(a => !step || a.url === step.targetRef);
}

function hasInbound(o: Observation): boolean {
  return o.messages.some(m => m.direction === 'inbound') || o.calls.some(c => !!c.transcript);
}

export function switchDeadline(startedAt: string, next: PlanStep | null, o: Pick<Observation, 'scale' | 'tz'>): Date {
  const m = next ? /^business_days:(\d+)$/.exec(next.waitFor) : null;
  const days = m ? Number(m[1]) : DEFAULT_SWITCH_BUSINESS_DAYS;
  const anchor = new Date(startedAt);
  return scaleDeadline(anchor, addBusinessDays(anchor, days, o.tz), o.scale);
}

export function allowedActions(agent: Pick<ResourceAgent, 'strategy' | 'strategyStep' | 'memory'>, o: Observation): Allowed {
  const steps = o.plan ? strategySteps(o.plan) : [];
  const idx = Math.min(agent.strategyStep, Math.max(steps.length - 1, 0));
  const currentStep = steps[idx] ?? null;
  const nextStep = steps[idx + 1] ?? null;
  const currentChannel = currentStep ? CHANNEL_OF[currentStep.channel] : (agent.strategy[agent.strategyStep] ?? null);
  const pending = pendingApprovals(o);
  const why: Allowed['why'] = {};
  const add = (a: AgentAction, w: string) => { if (!why[a]) why[a] = w; };
  const base = { currentChannel, currentStep, nextStep, pendingApproval: pending };

  // Terminal outcomes: the only thing left is to finish.
  if (o.contact && FINISHED_STATES.has(o.contact.state)) {
    return { ...base, actions: ['finish'], why: { finish: `contact is ${o.contact.state.replace('_', ' ')}` }, switchAt: null };
  }
  if (o.applications.some(a => a.status === 'submitted' || !!a.submittedAt) && steps.length > 0 && currentChannel === 'web' && !nextStep) {
    add('finish', 'application submitted and no further channel planned');
  }
  if (!o.consent.approved) {
    return { ...base, actions: ['escalate', 'wait'], why: { escalate: 'no consent on file for this resource', wait: 'waiting for consent' }, switchAt: null };
  }

  const openTasks = o.tasks.filter(t => t.status === 'open');
  const unanswered = openTasks.filter(t => REQUEST_KINDS.has(t.kind) && !agent.memory.answered.includes(t.id));
  if (unanswered.length) add('answer_request', `they asked for ${unanswered.map(t => t.kind).join(' and ')}`);
  const needsPatient = openTasks.filter(t => ESCALATE_KINDS.has(t.kind));
  if (needsPatient.length) add('escalate', `a ${needsPatient[0].kind} request needs the patient's decision`);

  // While a draft waits for the patient nothing new is drafted (one outbound in flight per agent).
  if (pending > 0) {
    add('wait', `${pending} draft${pending > 1 ? 's' : ''} waiting for the patient's approval`);
    return { ...base, actions: order(why), why, switchAt: null };
  }

  const engaged = !!o.contact && ENGAGED_STATES.has(o.contact.state);
  const startedAt = agent.memory.channelStartedAt;
  let switchAt: Date | null = null;
  if (currentChannel && currentStep && !engaged && !hasInbound(o)) {
    const done = hasOutboundOn(o, currentChannel, currentStep);
    const banned = !!agent.memory.constraints?.channels && !agent.memory.constraints.channels.includes(currentChannel);
    const unavailable = banned || agent.memory.done.includes(`unavailable:${currentStep.id}`) || currentChannel === 'web' && o.applications.some(a => a.url === currentStep.targetRef && (a.status === 'not_available' || a.status === 'failed'));
    if (!done && !unavailable) {
      if (currentChannel === 'email' && o.contact?.channel === 'email' && o.contact.state === 'drafted') add('draft_email', 'first email to this resource is not written yet');
      if (currentChannel === 'call') add('draft_call', 'the plan calls this resource next');
      if (currentChannel === 'web') add('fill_web', 'their online application is not filled in yet');
    }
    if (nextStep && unavailable) add('switch_channel', `${currentChannel} is ${banned ? 'switched off by the patient' : 'not available here'}; ${CHANNEL_OF[nextStep.channel]} is next in the plan`);
    if (nextStep && done && startedAt) {
      switchAt = switchDeadline(startedAt, nextStep, o);
      if (o.now.getTime() >= switchAt.getTime()) add('switch_channel', `no reply by ${switchAt.toISOString().slice(0, 10)}; ${CHANNEL_OF[nextStep.channel]} is next`);
    }
    if (!nextStep && unavailable) add('escalate', `${currentChannel} is not available and no other channel is planned`);
    if (!nextStep && o.contact?.state === 'stalled') add('escalate', 'no reply on any planned channel');
  }
  if (o.contact?.state === 'sent' && o.contact.nextFollowUpAt && Date.parse(o.contact.nextFollowUpAt) <= o.now.getTime() && o.contact.followUpsSent < 2 && !engaged) {
    add('follow_up', 'a walk-away follow-up is due on this thread');
  }
  add('wait', engaged ? 'they replied; waiting for their next step' : 'nothing is due yet');
  return { ...base, actions: order(why), why, switchAt };
}

const PRIORITY: AgentAction[] = ['finish', 'answer_request', 'escalate', 'draft_email', 'draft_call', 'fill_web', 'switch_channel', 'follow_up', 'wait'];
function order(why: Allowed['why']): AgentAction[] {
  return PRIORITY.filter(a => why[a]);
}

/** The deterministic choice: highest-priority allowed action (used offline without a fixture, and on model failure). */
export function defaultDecision(allowed: Allowed): AgentDecision {
  const action = allowed.actions[0] ?? 'wait';
  return { action, reason: allowed.why[action] ?? 'nothing to do yet' };
}
