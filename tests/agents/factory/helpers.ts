import type { ContactPlan, PlanStep, ResourcePlan } from '@/lib/plan/contract';
import type { Observation } from '@/lib/agents/factory/policy';
import type { AgentEffects, CandidateDoc } from '@/lib/agents/factory/step';

export const CASE = '11111111-1111-4111-8111-111111111111';
export const NOW = new Date('2026-10-19T15:00:00Z'); // a Monday

export function step(id: string, order: number, channel: PlanStep['channel'], waitFor: PlanStep['waitFor'] = 'none', purpose: PlanStep['purpose'] = 'intro', targetRef = `ev-${id}`): PlanStep {
  return { id, order, channel, purpose, targetRef, reason: 'r', evidenceIds: ['e1'], waitFor, enabled: true };
}
export function resource(key: string, name: string, steps: PlanStep[], contactId: string | null, targetKind: ResourcePlan['targetKind'] = 'institution', rule = 'institution_email_then_call'): ResourcePlan {
  const [kind, id] = key.split(':');
  return { resourceKey: key, targetKind: (kind as ResourcePlan['targetKind']) ?? targetKind, targetId: id, name, contactId, rule, steps, unavailableReason: null };
}
export function plan(resources: ResourcePlan[]): ContactPlan {
  const t = NOW.toISOString();
  return { caseId: CASE, version: 2, status: 'approved', source: 'rules', summary: 's', resources, createdAt: t, updatedAt: t, approvedAt: t };
}

export function observation(over: Partial<Observation> = {}): Observation {
  return {
    now: NOW, scale: 1, contact: { id: 'c1', channel: 'email', state: 'drafted', firstSentAt: null, nextFollowUpAt: null, followUpsSent: 0 },
    consent: { sharedFields: ['diseaseName'], approved: true }, plan: null, messages: [], calls: [], applications: [], tasks: [], pendingVerifications: 0, ...over,
  };
}

/** Effects that record calls and never send; `sent` must stay empty. */
export function fakeEffects(o: () => Observation, docs: CandidateDoc[] = []) {
  const calls: string[] = [];
  const sent: string[] = [];
  const answers: { taskId: string; docIds: string[] }[] = [];
  const effects: AgentEffects = {
    observe: async () => o(),
    draftMessage: async (_a, cid) => { calls.push(`draft:${cid}`); return { id: 'd1' }; },
    prepareCall: async () => { calls.push('call'); return { id: 'call1' }; },
    fillWeb: async (_a, url) => { calls.push(`web:${url}`); return { ok: true, id: 'app1' }; },
    followUp: async () => { calls.push('follow_up'); return 'cadence'; },
    findDocuments: async () => docs,
    attachAnswer: async (_a, t, d) => { answers.push({ taskId: t.id, docIds: d.map(x => x.id) }); },
    escalate: async () => { calls.push('escalate'); },
  };
  return { effects, calls, sent, answers };
}
