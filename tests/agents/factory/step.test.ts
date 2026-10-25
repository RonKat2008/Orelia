import { describe, expect, it } from 'vitest';
import { MemoryAgentStore } from '@/lib/agents/factory/store';
import { step, shareableDocs } from '@/lib/agents/factory/step';
import { runAgent, sweepDueAgents, wakeAgentForContact } from '@/lib/agents/factory/runner';
import { allowedActions } from '@/lib/agents/factory/policy';
import { acceptDecision, defaultDecider, fixtureKey } from '@/lib/agents/factory/decide';
import type { Decider } from '@/lib/agents/factory/decide';
import type { Observation } from '@/lib/agents/factory/policy';
import { CASE, NOW, fakeEffects, observation, resource, step as planStep } from './helpers';

const cc = resource('institution:cc', 'Cleveland Clinic', [planStep('s1', 1, 'email'), planStep('s2', 2, 'voice', 'business_days:3')], 'c1');
const rules: Decider = async (_a, _o, allowed) => ({ decision: { action: allowed.actions[0], reason: allowed.why[allowed.actions[0]] ?? 'x' }, source: 'rules' });

async function setup(o: () => Observation) {
  const store = new MemoryAgentStore(() => NOW);
  const { agent } = await store.upsert({ caseId: CASE, contactId: 'c1', resourceKey: cc.resourceKey, name: 'Cleveland Clinic agent', goal: 'appointment', strategy: ['email', 'call'] });
  const fx = fakeEffects(o);
  return { store, agent, fx, deps: { store, effects: fx.effects, decide: rules, now: () => NOW } };
}

describe('ResourceAgent step()', () => {
  it('drafts the first email but never sends; then waits while the draft awaits approval', async () => {
    let o = observation({ plan: cc });
    const { agent, fx, deps, store } = await setup(() => o);
    const r1 = await step(agent.id, deps, 'spawn');
    expect(r1.action).toBe('draft_email');
    expect(r1.waitFor).toBe('approval');
    expect(fx.calls).toEqual(['draft:c1']);
    expect(fx.sent).toEqual([]);
    // The draft now exists, unapproved: nothing else may be drafted.
    o = observation({ plan: cc, messages: [{ id: 'd1', direction: 'outbound', channel: 'email', approvedAt: null, sentAt: null, receivedAt: null, classification: null }] });
    const r2 = await step(agent.id, deps, 'cron');
    expect(r2.action).toBe('wait');
    expect(fx.calls).toEqual(['draft:c1']);
    expect((await store.get(agent.id))!.state).toBe('awaiting_approval');
    const ev = await store.events(agent.id, 5);
    expect(ev[0]).toMatchObject({ kind: 'decision', action: 'wait' });
    expect(ev[1]).toMatchObject({ action: 'draft_email', result: expect.stringContaining('waiting for the patient') });
  });

  it('a model choosing a non-allowed action is rejected (code decides what is allowed)', () => {
    const allowed = allowedActions({ strategy: ['email', 'call'], strategyStep: 0, memory: { done: [] } as never }, observation({ plan: cc }));
    expect(allowed.actions).not.toContain('finish');
    expect(acceptDecision({ action: 'finish', reason: 'done' }, allowed)).toBeNull();
    expect(acceptDecision({ action: 'draft_email' }, allowed)).toBeNull();
    expect(acceptDecision({ action: 'draft_email', reason: 'ok' }, allowed)).toEqual({ action: 'draft_email', reason: 'ok' });
  });

  it('switches channel after no reply by the cadence deadline, then prepares a call for approval', async () => {
    const sentAt = '2026-10-12T15:00:00Z'; // previous Monday
    const sentEmail = { id: 'm1', direction: 'outbound' as const, channel: 'email' as const, approvedAt: sentAt, sentAt, receivedAt: null, classification: null };
    let now = new Date('2026-10-14T15:00:00Z'); // 2 business days later: not yet
    const o = () => observation({ now, plan: cc, contact: { id: 'c1', channel: 'email', state: 'sent', firstSentAt: sentAt, nextFollowUpAt: null, followUpsSent: 0 }, messages: [sentEmail] });
    const { agent, fx, deps, store } = await setup(o);
    const early = await runAgent(agent.id, { ...deps, now: () => now }, 'cron');
    expect('steps' in early && early.steps[0].action).toBe('wait');
    expect((await store.get(agent.id))!.strategyStep).toBe(0);
    expect(Date.parse((await store.get(agent.id))!.nextActionAt!)).toBe(Date.parse('2026-10-15T15:00:00Z'));
    now = new Date('2026-10-15T15:00:01Z'); // 3 business days: deadline passed
    const late = await runAgent(agent.id, { ...deps, now: () => now }, 'cron');
    expect('steps' in late && late.steps.map(s => s.action)).toEqual(['switch_channel', 'draft_call']);
    expect((await store.get(agent.id))!.strategyStep).toBe(1);
    expect(fx.calls).toEqual(['call']);
    expect(fx.sent).toEqual([]);
  });

  it('answers a records request only with shareable documents', async () => {
    const o = () => observation({ plan: cc, contact: { id: 'c1', channel: 'email', state: 'task_open', firstSentAt: '2026-10-12T15:00:00Z', nextFollowUpAt: null, followUpsSent: 0 },
      messages: [{ id: 'm1', direction: 'outbound', channel: 'email', approvedAt: 'x', sentAt: '2026-10-12T15:00:00Z', receivedAt: null, classification: null }, { id: 'i1', direction: 'inbound', channel: 'email', approvedAt: null, sentAt: null, receivedAt: '2026-10-13T15:00:00Z', classification: 'records', body: 'please send the MRI report' }],
      tasks: [{ id: 't1', kind: 'records', title: 'Send MRI report', status: 'open' }] });
    const store = new MemoryAgentStore(() => NOW);
    const { agent } = await store.upsert({ caseId: CASE, contactId: 'c1', resourceKey: cc.resourceKey, name: 'CC agent', goal: 'appointment', strategy: ['email', 'call'] });
    const docs = [
      { id: 'acct-shared', title: 'MRI report', source: 'account' as const, sharedField: null, shareable: true },
      { id: 'acct-private', title: 'Therapy notes', source: 'account' as const, sharedField: null, shareable: false },
      { id: 'case-ticked', title: 'Diagnosis', source: 'case' as const, sharedField: 'diseaseName', shareable: true },
      { id: 'case-unticked', title: 'Insurance', source: 'case' as const, sharedField: 'insurer', shareable: true },
    ];
    const fx = fakeEffects(o, docs);
    const r = await step(agent.id, { store, effects: fx.effects, decide: rules, now: () => NOW });
    expect(r.action).toBe('answer_request');
    expect(fx.answers).toEqual([{ taskId: 't1', docIds: ['acct-shared', 'case-ticked'] }]);
    expect(shareableDocs(docs.filter(d => !d.shareable), ['diseaseName'])).toEqual([]);
    // Answered once: the next step does not answer it again.
    const r2 = await step(agent.id, { store, effects: fx.effects, decide: rules, now: () => NOW });
    expect(r2.action).not.toBe('answer_request');
  });

  it('the lease prevents double-acting', async () => {
    const o = () => observation({ plan: cc });
    const { agent, fx, deps, store } = await setup(o);
    expect(await store.acquireLease(agent.id, 'other-run', NOW, 60_000)).toBe(true);
    const blocked = await runAgent(agent.id, deps, 'cron');
    expect(blocked).toEqual({ agentId: agent.id, skipped: 'lease' });
    expect(fx.calls).toEqual([]);
    // Concurrent runs: exactly one acts.
    await store.releaseLease(agent.id, 'other-run');
    const both = await Promise.all([runAgent(agent.id, deps, 'cron'), runAgent(agent.id, deps, 'webhook:email')]);
    expect(both.filter(r => 'skipped' in r).length).toBe(1);
    expect(fx.calls).toEqual(['draft:c1']);
    // An expired lease can be taken over.
    expect(await store.acquireLease(agent.id, 'stuck', NOW, 1)).toBe(true);
    expect(await store.acquireLease(agent.id, 'next', new Date(NOW.getTime() + 10), 1000)).toBe(true);
  });

  it('a webhook wakes the agent for that contact immediately; unknown contacts are a no-op', async () => {
    const sentAt = '2026-10-12T15:00:00Z';
    const o = () => observation({ plan: cc, contact: { id: 'c1', channel: 'email', state: 'replied', firstSentAt: sentAt, nextFollowUpAt: null, followUpsSent: 0 },
      messages: [{ id: 'm1', direction: 'outbound', channel: 'email', approvedAt: sentAt, sentAt, receivedAt: null, classification: null }, { id: 'i1', direction: 'inbound', channel: 'email', approvedAt: null, sentAt: null, receivedAt: '2026-10-13T10:00:00Z', classification: null, body: 'Thanks, we will review.', from: 'Intake Desk <intake@example.org>' }] });
    const { agent, deps, store } = await setup(o);
    expect(await wakeAgentForContact('nobody', 'webhook:email', deps)).toBeNull();
    const r = await wakeAgentForContact('c1', 'webhook:email', deps);
    expect(r && 'steps' in r && r.steps[0].action).toBe('wait');
    const saved = (await store.get(agent.id))!;
    expect(saved.memory.replies).toBe(1);
    expect(saved.memory.spokeWith).toEqual(['Intake Desk']);
    expect((await store.events(agent.id, 1))[0].trigger).toBe('webhook:email');
  });

  it('the cron sweep runs only due agents', async () => {
    const o = () => observation({ plan: cc });
    const { agent, deps, store } = await setup(o);
    expect(await sweepDueAgents(deps)).toEqual({ ran: 0, skipped: 0, failed: 0 });
    await store.update(agent.id, { nextActionAt: new Date(NOW.getTime() - 1000).toISOString() });
    expect(await sweepDueAgents(deps)).toEqual({ ran: 1, skipped: 0, failed: 0 });
  });

  it('finishes when the appointment is booked', async () => {
    const o = () => observation({ plan: cc, contact: { id: 'c1', channel: 'email', state: 'appointment_booked', firstSentAt: null, nextFollowUpAt: null, followUpsSent: 0 } });
    const { agent, deps } = await setup(o);
    const r = await step(agent.id, deps);
    expect(r).toMatchObject({ action: 'finish', done: true, nextActionAt: null });
  });

  it('offline fixtures drive the decision and stay inside the allowed set', async () => {
    const prev = process.env.WAYFINDER_OFFLINE;
    process.env.WAYFINDER_OFFLINE = '1';
    try {
      const o = observation({ plan: cc, contact: { id: 'c1', channel: 'email', state: 'task_open', firstSentAt: null, nextFollowUpAt: null, followUpsSent: 0 }, tasks: [{ id: 't1', kind: 'records', title: 'MRI', status: 'open' }, { id: 't2', kind: 'unclear', title: '?', status: 'open' }] });
      const agent = { goal: 'appointment', strategy: ['email', 'call'], strategyStep: 0, memory: { done: [], answered: [] } } as never;
      const allowed = allowedActions(agent, o);
      const d = await defaultDecider(agent, o, allowed);
      expect(fixtureKey(agent, allowed)).toBe('appointment:answer_request+escalate+wait');
      expect(d.source).toBe('fixture');
      expect(allowed.actions).toContain(d.decision.action);
    } finally {
      if (prev === undefined) delete process.env.WAYFINDER_OFFLINE; else process.env.WAYFINDER_OFFLINE = prev;
    }
  });
});
