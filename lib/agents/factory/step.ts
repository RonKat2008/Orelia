/**
 * One ResourceAgent step: load state -> observe its OWN contact/threads/calls/applications -> compute the allowed
 * actions (code) -> let the model choose one (decide.ts) -> perform it as a DRAFT or a bookkeeping change -> log an
 * event -> return when to look again. step() never schedules anything and never sends: the effects it can call only
 * write unapproved drafts (or prepare a verification call / application that waits for approval). Scheduling, leases
 * and waking live in runner.ts (cron + webhooks now, a durable Workflow later).
 */
import { allowedActions, IDLE_RECHECK_MS, pendingApprovals, strategySteps, type Allowed, type Observation, type ObservedTask } from './policy';
import { defaultDecider, type Decider } from './decide';
import type { AgentStore } from './store';
import type { AgentAction, AgentChannel, AgentMemory, AgentState, AgentTrigger, ResourceAgent } from './types';

export type WaitFor = 'reply' | 'call_result' | 'web_result' | 'approval' | null;
export interface StepResult {
  agentId: string;
  action: AgentAction;
  reason: string;
  result: string;
  nextActionAt: string | null;
  waitFor: WaitFor;
  done: boolean;
  /** True when another step should follow right away (e.g. after a channel switch). */
  again: boolean;
}

/** A document the agent might attach. Only patient-shareable ones ever reach a resource. */
export interface CandidateDoc { id: string; title: string; source: 'case' | 'account'; sharedField: string | null; shareable: boolean }

export interface AgentEffects {
  observe(agent: ResourceAgent): Promise<Observation>;
  /** Writes (or reuses) the UNAPPROVED first message for the agent's contact on its own channel. Never sends. */
  draftMessage(agent: ResourceAgent, contactId: string): Promise<{ id: string }>;
  /** Prepares a call that waits for approval (voice contact draft, or a verification call). Never dials. */
  prepareCall(agent: ResourceAgent, o: Observation): Promise<{ id: string } | { unavailable: string }>;
  /** Fills (never submits) the online application; submission waits for the patient's approval. */
  fillWeb(agent: ResourceAgent, url: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
  /** Walk-away follow-ups stay with the cadence machinery (pre-approved or drafted); returns what it did. */
  followUp(agent: ResourceAgent, contactId: string): Promise<string>;
  /** Candidate documents for a request (case docs for this contact + the patient's account library). */
  findDocuments(agent: ResourceAgent, task: ObservedTask): Promise<CandidateDoc[]>;
  /** Attaches the chosen (shareable) documents to the request's reply draft; still needs the patient's approval. */
  attachAnswer(agent: ResourceAgent, task: ObservedTask, docs: CandidateDoc[]): Promise<void>;
  escalate(agent: ResourceAgent, reason: string): Promise<void>;
}

export interface StepDeps {
  store: AgentStore;
  effects: AgentEffects;
  decide?: Decider;
  now?: () => Date;
  /** Optional: queue a patient update (chat + email digest) for a meaningful moment. Must not throw. */
  report?: (agent: ResourceAgent, update: PatientUpdate) => Promise<void>;
}

export interface PatientUpdate { text: string; urgent: boolean; draft?: { contactId: string; draftId: string; label: string } }

/** Which moments are worth telling the patient about (pure; the digest batches them). */
export function meaningfulUpdate(before: ResourceAgent, after: AgentMemory, action: AgentAction, out: { result: string; blocked?: boolean; data?: Record<string, unknown> }, o: Observation): PatientUpdate | null {
  const short = before.name.replace(/ agent$/, '');
  if (after.replies > before.memory.replies) return { text: `${short} replied. Open the app to read it.`, urgent: false };
  if (action === 'finish' && o.contact?.state === 'appointment_booked') return { text: `An appointment with ${short} is booked.`, urgent: true };
  if (action === 'escalate') return { text: `${short}: I need your decision on something.`, urgent: true };
  if (out.blocked) return null;
  if (action === 'draft_email' && typeof out.data?.draftId === 'string' && o.contact) return { text: `A message to ${short} is ready for your approval.`, urgent: false, draft: { contactId: o.contact.id, draftId: out.data.draftId, label: `first email to ${short}` } };
  if (action === 'draft_call' || action === 'fill_web' || action === 'answer_request' || action === 'draft_email') return { text: `${short}: something is ready for your approval.`, urgent: false };
  if (action === 'follow_up') return { text: `${short}: ${out.result}.`, urgent: false };
  if (action === 'switch_channel') return { text: `${short} has not replied, so I'm trying ${out.result.replace('switched to ', '')} next.`, urgent: false };
  if (o.contact?.state === 'stalled' && before.state !== 'escalated') return { text: `${short} has not replied after the follow-ups.`, urgent: false };
  return null;
}

/** Only ticked consent fields and documents the patient marked shareable. */
export function shareableDocs(docs: CandidateDoc[], consentFields: readonly string[]): CandidateDoc[] {
  return docs.filter(d => d.source === 'account' ? d.shareable : (d.shareable && (!d.sharedField || consentFields.includes(d.sharedField))));
}

const CHANNEL_WAIT: Record<AgentChannel, WaitFor> = { email: 'reply', call: 'call_result', web: 'web_result' };

function firstSentOn(o: Observation, ch: AgentChannel | null): string | null {
  const times = ch === 'email' ? o.messages.filter(m => m.direction === 'outbound' && m.channel === 'email').map(m => m.sentAt)
    : ch === 'call' ? [...o.calls.map(c => c.startedAt), ...o.messages.filter(m => m.direction === 'outbound' && m.channel === 'voice').map(m => m.sentAt)]
    : ch === 'web' ? o.applications.map(a => a.submittedAt) : [];
  const valid = times.filter((t): t is string => !!t).sort();
  return valid[0] ?? null;
}

export function rememberObservation(memory: AgentMemory, o: Observation, current: AgentChannel | null): AgentMemory {
  const inbound = o.messages.filter(m => m.direction === 'inbound');
  const transcripts = o.calls.filter(c => c.transcript);
  const lastInbound = [...inbound.map(m => m.receivedAt), ...o.calls.map(c => c.endedAt && c.transcript ? c.endedAt : null)].filter((t): t is string => !!t).sort().pop() ?? null;
  const spoke = new Set(memory.spokeWith);
  for (const m of inbound) if (m.from) spoke.add(m.from.replace(/<.*>/, '').trim().slice(0, 80) || m.from.slice(0, 80));
  if (transcripts.length) spoke.add('phone intake line');
  const requests = o.tasks.filter(t => t.status === 'open').map(t => ({ taskId: t.id, kind: t.kind, title: (t.title ?? t.kind).slice(0, 120) }));
  const remaining = requests.filter(r => !memory.answered.includes(r.taskId)).map(r => r.title);
  const startedAt = memory.channelStartedAt ?? firstSentOn(o, current);
  const summary = [
    o.contact ? `Thread ${o.contact.state.replace('_', ' ')}` : 'No email/phone thread',
    inbound.length ? `${inbound.length} repl${inbound.length > 1 ? 'ies' : 'y'}` : null,
    transcripts.length ? `${transcripts.length} call transcript${transcripts.length > 1 ? 's' : ''}` : null,
    o.applications.length ? `${o.applications.length} application${o.applications.length > 1 ? 's' : ''}` : null,
    remaining.length ? `open: ${remaining.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  return { ...memory, summary, spokeWith: [...spoke].slice(0, 10), requests, remaining, replies: inbound.length, calls: o.calls.length, applications: o.applications.length, lastInboundAt: lastInbound, channelStartedAt: startedAt };
}

/** While a draft waits for the patient, look again soon so an approval moves the agent on without a webhook. */
export const APPROVAL_RECHECK_MS = 15 * 60 * 1000;

function nextLook(o: Observation, allowed: Allowed, now: Date, waitFor: WaitFor): string {
  // Wake at the next real deadline; webhooks wake it sooner. Without a deadline, look again after an idle period.
  const idle = now.getTime() + (waitFor === 'approval' ? APPROVAL_RECHECK_MS : IDLE_RECHECK_MS) / Math.max(1, o.scale);
  const candidates: number[] = [];
  if (allowed.switchAt && allowed.switchAt.getTime() > now.getTime()) candidates.push(allowed.switchAt.getTime());
  const fu = o.contact?.nextFollowUpAt ? Date.parse(o.contact.nextFollowUpAt) : NaN;
  if (Number.isFinite(fu) && fu > now.getTime()) candidates.push(fu);
  return new Date(candidates.length ? Math.min(...candidates) : idle).toISOString();
}

interface Outcome { result: string; state: AgentState; waitFor: WaitFor; memory: AgentMemory; strategyStep?: number; again?: boolean; done?: boolean; blocked?: boolean; data?: Record<string, unknown> }

async function perform(action: AgentAction, reason: string, agent: ResourceAgent, o: Observation, allowed: Allowed, memory: AgentMemory, fx: AgentEffects): Promise<Outcome> {
  const contactId = o.contact?.id ?? agent.contactId;
  const waitCurrent = allowed.currentChannel ? CHANNEL_WAIT[allowed.currentChannel] : 'reply';
  switch (action) {
    case 'draft_email': {
      if (!contactId) return { result: 'no email thread for this resource', state: 'working', waitFor: null, memory, blocked: true };
      const d = await fx.draftMessage(agent, contactId);
      return { result: 'email drafted; waiting for the patient to approve it', state: 'awaiting_approval', waitFor: 'approval', memory, data: { draftId: d.id } };
    }
    case 'draft_call': {
      const r = await fx.prepareCall(agent, o);
      if ('unavailable' in r) {
        const step = allowed.currentStep;
        return { result: `call not available: ${r.unavailable}`, state: 'working', waitFor: null, blocked: true, again: !!allowed.nextStep, memory: step ? { ...memory, done: [...memory.done, `unavailable:${step.id}`] } : memory };
      }
      return { result: 'call script ready; waiting for the patient to approve the call', state: 'awaiting_approval', waitFor: 'approval', memory, data: { callId: r.id } };
    }
    case 'fill_web': {
      const step = allowed.currentStep;
      if (!step) return { result: 'no online application in the plan', state: 'working', waitFor: null, memory, blocked: true };
      const r = await fx.fillWeb(agent, step.targetRef);
      if (!r.ok) return { result: `application not available: ${r.reason}`, state: 'working', waitFor: null, blocked: true, again: !!allowed.nextStep, memory: { ...memory, done: [...memory.done, `unavailable:${step.id}`] } };
      return { result: 'application filled in; waiting for the patient to review and approve it', state: 'awaiting_approval', waitFor: 'approval', memory, data: { applicationId: r.id } };
    }
    case 'follow_up': {
      if (!contactId) return { result: 'no thread to follow up on', state: 'waiting_reply', waitFor: 'reply', memory, blocked: true };
      return { result: await fx.followUp(agent, contactId), state: 'waiting_reply', waitFor: 'reply', memory };
    }
    case 'answer_request': {
      const task = o.tasks.find(t => t.status === 'open' && (t.kind === 'records' || t.kind === 'slides') && !memory.answered.includes(t.id));
      if (!task) return { result: 'no open request', state: 'working', waitFor: null, memory };
      const docs = shareableDocs(await fx.findDocuments(agent, task), o.consent.sharedFields);
      await fx.attachAnswer(agent, task, docs);
      const answered = { ...memory, answered: [...memory.answered, task.id], remaining: memory.remaining.filter(r => r !== (task.title ?? task.kind)) };
      return {
        result: docs.length ? `reply prepared with ${docs.length} shareable document${docs.length > 1 ? 's' : ''}; waiting for approval` : 'no shareable document matches; asked the patient to mark one shareable',
        state: docs.length ? 'awaiting_approval' : 'escalated', waitFor: 'approval', memory: answered, again: false,
        data: { taskId: task.id, docIds: docs.map(d => d.id) },
      };
    }
    case 'switch_channel': {
      const next = Math.min(agent.strategyStep + 1, Math.max(agent.strategy.length - 1, 0));
      return { result: `switched to ${agent.strategy[next] ?? 'next channel'}`, state: 'working', waitFor: null, strategyStep: next, again: true, memory: { ...memory, channelStartedAt: null } };
    }
    case 'escalate':
      await fx.escalate(agent, reason);
      return { result: 'asked the patient to decide', state: 'escalated', waitFor: 'approval', memory };
    case 'finish':
      return { result: o.contact ? `finished: ${o.contact.state.replace('_', ' ')}` : 'finished', state: 'done', waitFor: null, memory, done: true };
    case 'wait':
    default:
      return { result: 'waiting', state: pendingApprovals(o) > 0 ? 'awaiting_approval' : 'waiting_reply', waitFor: pendingApprovals(o) > 0 ? 'approval' : waitCurrent, memory };
  }
}

export async function step(agentId: string, deps: StepDeps, trigger: AgentTrigger = 'manual'): Promise<StepResult> {
  const now = deps.now?.() ?? new Date();
  const agent = await deps.store.get(agentId);
  if (!agent) throw new Error('resource agent not found');
  if (agent.state === 'done') return { agentId, action: 'finish', reason: 'already done', result: 'done', nextActionAt: null, waitFor: null, done: true, again: false };
  const o = await deps.effects.observe(agent);
  const steps = o.plan ? strategySteps(o.plan) : [];
  const current = agent.strategy[agent.strategyStep] ?? null;
  const memory = rememberObservation(agent.memory, o, current);
  const allowed = allowedActions({ ...agent, memory }, o);
  const { decision, source } = await (deps.decide ?? defaultDecider)({ ...agent, memory }, o, allowed);
  let out: Outcome;
  try {
    out = await perform(decision.action, decision.reason, agent, o, allowed, memory, deps.effects);
  } catch (err) {
    const code = (err as { reasons?: string[] })?.reasons?.[0] ?? (err instanceof Error ? err.name : 'error');
    out = { result: `could not ${decision.action.replace('_', ' ')}: ${code}`, state: 'working', waitFor: null, memory, blocked: true };
  }
  const nextActionAt = out.done ? null : out.again ? now.toISOString() : nextLook(o, allowed, now, out.waitFor);
  await deps.store.update(agentId, {
    state: out.state, memory: out.memory, lastRunAt: now.toISOString(), nextActionAt,
    nextAction: out.done ? null : out.again ? 'continue' : (allowed.switchAt && allowed.nextStep ? `switch to ${agent.strategy[agent.strategyStep + 1] ?? 'next'} if no reply` : out.waitFor ? `wait for ${out.waitFor.replace('_', ' ')}` : 'check again'),
    ...(out.strategyStep !== undefined ? { strategyStep: out.strategyStep } : {}),
  });
  const update = deps.report ? meaningfulUpdate(agent, out.memory, decision.action, out, o) : null;
  if (update) await deps.report!(agent, update).catch(() => undefined);
  await deps.store.appendEvent({
    agentId, caseId: agent.caseId, kind: out.blocked ? 'blocked' : 'decision', trigger, reason: decision.reason, action: decision.action, result: out.result,
    data: { source, allowed: allowed.actions, channel: current, step: agent.strategyStep, steps: steps.length, ...(out.data ?? {}) },
  });
  return { agentId, action: decision.action, reason: decision.reason, result: out.result, nextActionAt, waitFor: out.waitFor, done: !!out.done, again: !!out.again };
}
