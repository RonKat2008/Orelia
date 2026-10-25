/**
 * Offline agent-factory walkthrough (used by scripts/demo-offline.ts): plan approved -> one ResourceAgent per resource
 * -> each decides its next step -> drafts wait for approval -> no reply by the cadence deadline -> channel switch ->
 * a call transcript wakes the agent -> a records request is answered with shareable documents only -> chat.
 * In-memory stores and simulated effects; nothing leaves the machine and nothing is ever sent.
 */
import { spawnAgentsForPlan } from '@/lib/agents/factory/factory';
import { MemoryAgentStore } from '@/lib/agents/factory/store';
import { runAgent, wakeAgentForContact } from '@/lib/agents/factory/runner';
import { handleChat, MemoryChatStore } from '@/lib/agents/factory/chat';
import type { Observation, ObservedMessage } from '@/lib/agents/factory/policy';
import type { AgentEffects } from '@/lib/agents/factory/step';
import type { ContactPlan, PlanStep, ResourcePlan } from '@/lib/plan/contract';

const CASE = '00000000-0000-4000-8000-00000000f00d';
const st = (id: string, order: number, channel: PlanStep['channel'], waitFor: PlanStep['waitFor'], targetRef = `ev-${id}`): PlanStep =>
  ({ id, order, channel, purpose: order === 1 ? 'intro' : 'follow_up', targetRef, reason: 'demo', evidenceIds: ['e'], waitFor, enabled: true });
const res = (key: string, name: string, rule: string, steps: PlanStep[], contactId: string | null): ResourcePlan => {
  const [kind, id] = key.split(':');
  return { resourceKey: key, targetKind: kind as ResourcePlan['targetKind'], targetId: id, name, contactId, rule, steps, unavailableReason: null };
};

export async function runAgentFactoryDemo(log: (s: string) => void = console.log): Promise<string[]> {
  const failures: string[] = [];
  let now = new Date('2026-10-19T14:00:00Z');
  const plan: ContactPlan = {
    caseId: CASE, version: 1, status: 'approved', source: 'rules', summary: 'demo', createdAt: now.toISOString(), updatedAt: now.toISOString(), approvedAt: now.toISOString(),
    resources: [
      res('institution:cc', 'Cleveland Clinic Sarcoma Program', 'institution_email_then_call', [st('s1', 1, 'email', 'none'), st('s2', 2, 'voice', 'business_days:3')], 'c-cc'),
      res('trial:NCT05000001', 'Tazemetostat basket trial', 'trial_call_only', [st('s1', 1, 'voice', 'none')], 'c-trial'),
      res('organization:aid', 'Sarcoma Patient Aid Fund', 'aid_form_only', [st('s1', 1, 'web_form', 'none', 'https://demo.example/aid/apply')], null),
    ],
  };
  // Simulated world: what each contact's thread looks like.
  const world = new Map<string, Observation>();
  const base = (contactId: string | null, channel: 'email' | 'voice', r: ResourcePlan): Observation => ({
    now, scale: 1, contact: contactId ? { id: contactId, channel, state: 'drafted', firstSentAt: null, nextFollowUpAt: null, followUpsSent: 0 } : null,
    consent: { sharedFields: ['diseaseName', 'homeState'], approved: true }, plan: r, messages: [], calls: [], applications: [], tasks: [], pendingVerifications: 0,
  });
  world.set('institution:cc', base('c-cc', 'email', plan.resources[0]));
  world.set('trial:NCT05000001', base('c-trial', 'voice', plan.resources[1]));
  world.set('organization:aid', base(null, 'email', plan.resources[2]));
  const sent: string[] = [];
  const upd = (key: string, f: (o: Observation) => Observation) => world.set(key, f(world.get(key)!));
  const effects: AgentEffects = {
    observe: async a => ({ ...world.get(a.resourceKey)!, now }),
    draftMessage: async (a) => { upd(a.resourceKey, o => ({ ...o, messages: [...o.messages, { id: `draft-${a.resourceKey}`, direction: 'outbound', channel: 'email', approvedAt: null, sentAt: null, receivedAt: null, classification: null }] })); return { id: `draft-${a.resourceKey}` }; },
    prepareCall: async (a) => { upd(a.resourceKey, o => ({ ...o, calls: [...o.calls, { id: `call-${a.resourceKey}-${o.calls.length + 1}`, approvedAt: null, startedAt: null, endedAt: null, outcome: null, transcript: null }] })); return { id: `call-${a.resourceKey}` }; },
    fillWeb: async (a, url) => { upd(a.resourceKey, o => ({ ...o, applications: [...o.applications, { id: 'app-1', url, status: 'draft', approvedAt: null, submittedAt: null }] })); return { ok: true, id: 'app-1' }; },
    followUp: async () => 'the cadence sweep drafts this follow-up',
    findDocuments: async () => [
      { id: 'doc-mri', title: 'MRI report (synthetic)', source: 'account', sharedField: null, shareable: true },
      { id: 'doc-notes', title: 'Therapy notes (synthetic)', source: 'account', sharedField: null, shareable: false },
    ],
    attachAnswer: async (_a, t, docs) => { log(`      answer for ${t.kind}: ${docs.map(d => d.title).join(', ') || 'none'}`); if (docs.some(d => d.id === 'doc-notes')) failures.push('non-shareable document attached'); },
    escalate: async () => undefined,
  };
  const store = new MemoryAgentStore(() => now);
  const deps = { store, effects, now: () => now };
  const show = async (label: string) => {
    log(`\n  ${label}`);
    for (const a of await store.listByCase(CASE)) {
      const ev = (await store.events(a.id, 1))[0];
      log(`    ${a.name.padEnd(42)} [${a.strategy.map((c, i) => (i === a.strategyStep ? `*${c}*` : c)).join(' > ')}] ${a.state.padEnd(17)} ${ev?.action ?? ''}: ${ev?.reason ?? ''} -> ${ev?.result ?? ''}`);
    }
  };
  const approveAndSend = (key: string) => upd(key, o => ({
    ...o, contact: o.contact ? { ...o.contact, state: 'sent', firstSentAt: now.toISOString() } : null,
    messages: o.messages.map(m => (m.direction === 'outbound' ? { ...m, approvedAt: now.toISOString(), sentAt: now.toISOString() } : m)),
    calls: o.calls.map(c => ({ ...c, approvedAt: c.approvedAt ?? now.toISOString(), startedAt: c.startedAt ?? now.toISOString() })),
    applications: o.applications.map(a => ({ ...a, approvedAt: now.toISOString(), submittedAt: now.toISOString(), status: 'submitted' })),
  }));

  log('\n===== agent factory (offline) =====');
  const spawned = await spawnAgentsForPlan(plan, { store, inboxProvider: { async create(i) { return { inboxId: `inbox-${i.clientId}`, email: `${i.username}@agentmail.to` }; } } });
  log(`  spawned ${spawned.created} agents: ${spawned.agents.map(a => `${a.name} (${a.goal}, ${a.inboxMode === 'own' ? a.inboxAddress : a.inboxMode})`).join('; ')}`);
  if (spawned.created !== 3) failures.push(`expected 3 agents, got ${spawned.created}`);
  if ((await spawnAgentsForPlan(plan, { store, inboxProvider: null })).created !== 0) failures.push('spawn not idempotent');
  for (const a of spawned.agents) await runAgent(a.id, deps, 'spawn');
  await show('Day 0, after spawn (every outbound is a draft):');
  if (sent.length) failures.push('something was sent');

  // The patient approves everything with one "Approve all".
  for (const k of world.keys()) approveAndSend(k);
  log('\n  Patient taps "Approve all" (each item still passes the outbound gate).');
  now = new Date('2026-10-19T16:00:00Z');
  for (const a of spawned.agents) await runAgent(a.id, deps, 'cron');
  await show('Day 0, waiting:');

  now = new Date('2026-10-22T15:00:00Z'); // 3 business days, no reply from Cleveland Clinic
  const ccAgent = spawned.agents.find(a => a.resourceKey === 'institution:cc')!;
  await runAgent(ccAgent.id, deps, 'cron');
  await show('Day 3, no reply by the cadence deadline:');
  if ((await store.get(ccAgent.id))!.strategyStep !== 1) failures.push('no channel switch after the cadence deadline');

  // The call is approved and placed; the transcript arrives by webhook with a records request.
  approveAndSend('institution:cc');
  upd('institution:cc', o => ({
    ...o, contact: o.contact ? { ...o.contact, state: 'task_open' } : null,
    calls: o.calls.map(c => ({ ...c, endedAt: now.toISOString(), outcome: 'completed', transcript: 'AI: This is an AI assistant calling for a patient. Callee: We can offer a consult; please send the latest MRI report.' })),
    messages: [...o.messages, { id: 'in-1', direction: 'inbound', channel: 'voice', approvedAt: null, sentAt: null, receivedAt: now.toISOString(), classification: 'records', from: 'Intake coordinator' } satisfies ObservedMessage],
    tasks: [{ id: 'task-records', kind: 'records', title: 'Send latest MRI report', status: 'open' }],
  }));
  await wakeAgentForContact('c-cc', 'webhook:voice', deps);
  await show('Call transcript arrives (webhook wakes only that agent):');

  const chat = { store, messages: new MemoryChatStore(), observe: effects.observe, findDocuments: (a: Parameters<AgentEffects['findDocuments']>[0], q: string) => effects.findDocuments(a, { id: 'chat', kind: 'records', title: q, status: 'open' }), draftNote: async () => ({ contactId: 'c-cc', draftId: 'draft-note' }), now: () => now };
  for (const m of ['What did they say?', "Don't call, email only", 'Ask them about telehealth', 'Should I stop my medication?']) {
    const r = await handleChat(ccAgent.id, m, chat);
    log(`  chat> ${m}\n        ${r.reply}${r.card ? ` [Approve and send: ${r.card.preview}]` : ''}`);
  }
  if (sent.length) failures.push('the factory sent something without approval');
  log(`\n  Sent without approval: ${sent.length} (must be 0)`);
  return failures;
}
