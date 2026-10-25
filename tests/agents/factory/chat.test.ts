import { describe, expect, it } from 'vitest';
import { MemoryAgentStore } from '@/lib/agents/factory/store';
import { applyInstruction, handleChat, MemoryChatStore, MEDICAL_REFUSAL, parseInstructionRules, type ChatDeps } from '@/lib/agents/factory/chat';
import { allowedActions } from '@/lib/agents/factory/policy';
import { emptyMemory } from '@/lib/agents/factory/types';
import { composeDigest, handlePatientReply, replyInstructionText, shouldSendDigest, signAgentApproval, verifyAgentApproval, type PatientReplyDeps } from '@/lib/agents/factory/report';
import { meaningfulUpdate } from '@/lib/agents/factory/step';
import { CASE, NOW, observation, resource, step } from './helpers';

const cc = resource('institution:cc', 'Cleveland Clinic', [step('s1', 1, 'email'), step('s2', 2, 'voice', 'business_days:3')], 'c1');

async function chatSetup(docs: { id: string; title: string; source: 'account' | 'case'; sharedField: string | null; shareable: boolean }[] = []) {
  const store = new MemoryAgentStore(() => NOW);
  const { agent } = await store.upsert({ caseId: CASE, contactId: 'c1', resourceKey: cc.resourceKey, name: 'Cleveland Clinic agent', goal: 'appointment', strategy: ['email', 'call'] });
  const drafts: { subject: string; body: string }[] = [];
  const messages = new MemoryChatStore();
  const deps: ChatDeps = {
    store, messages, now: () => NOW,
    observe: async () => observation({ plan: cc, messages: [{ id: 'i1', direction: 'inbound', channel: 'email', approvedAt: null, sentAt: null, receivedAt: '2026-10-13T10:00:00Z', classification: null, body: 'We can see her on Nov 3. Please send imaging.' }] }),
    findDocuments: async () => docs,
    draftNote: async (_a, input) => { drafts.push(input); return { contactId: 'c1', draftId: 'd-1' }; },
  };
  return { store, agent, deps, drafts, messages };
}

describe('agent chat instructions', () => {
  it('parses instructions into structured changes', () => {
    expect(parseInstructionRules('my new phone is +1 (346) 555-0100')).toEqual({ type: 'note', key: 'phone', value: '+1 (346) 555-0100' });
    expect(parseInstructionRules("I'm free Tuesdays only.")).toEqual({ type: 'note', key: 'availability', value: 'Tuesdays only' });
    expect(parseInstructionRules("don't call, email only")).toEqual({ type: 'constraint', channels: ['email', 'web'] });
    expect(parseInstructionRules('ask them about telehealth')).toEqual({ type: 'ask_resource', topic: 'telehealth' });
    expect(parseInstructionRules('send my MRI report')).toEqual({ type: 'send_document', document: 'MRI report' });
    expect(parseInstructionRules('Should I stop taking my medication?')).toEqual({ type: 'medical_question' });
    expect(parseInstructionRules('what did Cleveland Clinic say?')).toMatchObject({ type: 'question' });
  });

  it('an instruction becomes a memory update (and a constraint changes what the agent may do)', async () => {
    const { store, agent, deps } = await chatSetup();
    const r = await handleChat(agent.id, "Don't call, email only", deps);
    expect(r.memoryChanged).toBe(true);
    const saved = (await store.get(agent.id))!;
    expect(saved.memory.constraints.channels).toEqual(['email', 'web']);
    // With the call step current, the constraint makes the agent switch away instead of drafting a call.
    const allowed = allowedActions({ strategy: ['email', 'call'], strategyStep: 1, memory: saved.memory }, observation({ plan: cc, contact: null }));
    expect(allowed.actions).not.toContain('draft_call');
    const memory = applyInstruction(emptyMemory(), { type: 'note', key: 'phone', value: '555' }, NOW);
    expect(memory.notes).toEqual([{ key: 'phone', value: '555', at: NOW.toISOString() }]);
  });

  it('answers from its own thread and refuses medical advice', async () => {
    const { agent, deps, messages } = await chatSetup();
    const said = await handleChat(agent.id, 'What did Cleveland Clinic say?', deps);
    expect(said.reply).toContain('Nov 3');
    const med = await handleChat(agent.id, 'Should I stop taking my medication?', deps);
    expect(med.reply).toBe(MEDICAL_REFUSAL);
    expect(messages.rows.map(m => m.role)).toEqual(['user', 'agent', 'user', 'agent']);
  });

  it('a new action becomes an approval card (draft only), and documents must be shareable', async () => {
    const { agent, deps, drafts } = await chatSetup([
      { id: 'a1', title: 'MRI report', source: 'account', sharedField: null, shareable: false },
    ]);
    const ask = await handleChat(agent.id, 'ask them about telehealth', deps);
    expect(ask.card).toEqual({ kind: 'approve_send', contactId: 'c1', draftId: 'd-1', preview: 'Ask about telehealth' });
    const send = await handleChat(agent.id, 'send my MRI report', deps);
    expect(send.card).toBeUndefined();
    expect(send.reply).toMatch(/marked shareable/);
    expect(drafts.length).toBe(1);
  });
});

describe('patient updates and email replies', () => {
  const secret = 'test-secret';
  const t = (h: number) => new Date(NOW.getTime() + h * 3600_000);

  it('batches updates into a digest (urgent goes at once)', () => {
    const items = [{ urgent: false, at: NOW.toISOString() }];
    expect(shouldSendDigest([], null, NOW)).toBe(false);
    expect(shouldSendDigest(items, null, NOW)).toBe(true);
    expect(shouldSendDigest(items, t(-1).toISOString(), NOW)).toBe(false);
    expect(shouldSendDigest(items, t(-3).toISOString(), NOW)).toBe(true);
    expect(shouldSendDigest([...items, { urgent: true, at: NOW.toISOString() }], t(-1).toISOString(), NOW)).toBe(true);
    const d = composeDigest([
      { agentId: 'a', agentName: 'Cleveland Clinic agent', text: 'A message is ready for your approval.', urgent: false, at: NOW.toISOString(), draft: { contactId: 'c', draftId: 'd', label: 'first email' } },
      { agentId: 'b', agentName: 'Sarcoma Cancer Center agent', text: 'replied.', urgent: false, at: NOW.toISOString() },
    ], new Map([['d', 'CODE123']]), 'https://app/cases/x/tracker');
    expect(d.text).toContain('Cleveland Clinic agent: A message');
    expect(d.text).toContain('Agent 2: replied.'); // health words in a name never reach the email
    expect(d.text).toContain('APPROVE CODE123');
  });

  it('meaningful moments become updates', () => {
    const agent = { id: 'a', caseId: CASE, contactId: 'c1', resourceKey: 'k', name: 'CC agent', goal: 'appointment' as const, strategy: ['email' as const], strategyStep: 0, state: 'waiting_reply' as const, nextAction: null, nextActionAt: null, memory: emptyMemory(), inboxMode: 'own' as const, inboxId: null, inboxAddress: null, createdAt: '', lastRunAt: null };
    expect(meaningfulUpdate(agent, { ...emptyMemory(), replies: 1 }, 'wait', { result: 'waiting' }, observation())?.text).toBe('CC replied. Open the app to read it.');
    expect(meaningfulUpdate(agent, emptyMemory(), 'escalate', { result: 'x' }, observation())?.urgent).toBe(true);
    expect(meaningfulUpdate(agent, emptyMemory(), 'wait', { result: 'waiting' }, observation())).toBeNull();
  });

  function replyDeps(over: Partial<PatientReplyDeps> = {}) {
    const used = new Set<string>();
    const approved: string[] = [];
    const chats: string[] = [];
    const deps: PatientReplyDeps = {
      secret, now: () => NOW,
      verifiedEmail: async () => 'patient@test.example',
      agents: async () => [{ id: 'agent-1', name: 'Cleveland Clinic agent', contactId: 'c1' }],
      consume: async jti => (used.has(jti) ? false : (used.add(jti), true)),
      draftContact: async (agentId, draftId) => (agentId === 'agent-1' && draftId === 'draft-1' ? 'c1' : null),
      approve: async (_c, d) => { approved.push(d); return { ok: true }; },
      chat: async (_a, text) => { chats.push(text); },
      ...over,
    };
    return { deps, approved, chats };
  }

  it('an email reply from a non-patient address is ignored', async () => {
    const { deps, approved, chats } = replyDeps();
    const code = signAgentApproval({ agentId: 'agent-1', draftId: 'draft-1', now: NOW, secret });
    const r = await handlePatientReply({ caseId: CASE, from: 'Mallory <mallory@evil.example>', body: `APPROVE ${code}\nemail only` }, deps);
    expect(r).toEqual({ ignored: 'not_patient' });
    expect(approved).toEqual([]);
    expect(chats).toEqual([]);
    expect(await handlePatientReply({ caseId: CASE, from: 'patient@test.example', body: 'hi' }, { ...deps, verifiedEmail: async () => null })).toEqual({ ignored: 'no_verified_email' });
  });

  it('approves once by a signed code from the verified patient; a replayed token is refused', async () => {
    const { deps, approved, chats } = replyDeps();
    const code = signAgentApproval({ agentId: 'agent-1', draftId: 'draft-1', now: NOW, secret });
    const body = `APPROVE ${code}\nAlso, I'm free Tuesdays only.\n\nOn Mon, Wayfinder wrote:\n> Updates from your agents`;
    const first = await handlePatientReply({ caseId: CASE, from: 'Pat <PATIENT@test.example>', body }, deps);
    expect(first).toEqual({ approvals: [{ draftId: 'draft-1', result: 'sent' }], chattedWith: 'agent-1' });
    expect(chats).toEqual(["Also, I'm free Tuesdays only."]);
    const replay = await handlePatientReply({ caseId: CASE, from: 'patient@test.example', body: `APPROVE ${code}` }, deps);
    expect(replay).toEqual({ approvals: [{ draftId: 'draft-1', result: 'replayed' }], chattedWith: null });
    expect(approved).toEqual(['draft-1']);
  });

  it('refuses expired, forged and cross-agent codes', async () => {
    const { deps, approved } = replyDeps();
    const expired = signAgentApproval({ agentId: 'agent-1', draftId: 'draft-1', now: new Date(NOW.getTime() - 25 * 3600_000), secret });
    const forged = signAgentApproval({ agentId: 'agent-1', draftId: 'draft-1', now: NOW, secret: 'other' });
    const otherDraft = signAgentApproval({ agentId: 'agent-1', draftId: 'draft-9', now: NOW, secret });
    expect(verifyAgentApproval(expired, secret, NOW)).toEqual({ ok: false, reason: 'expired' });
    const r = await handlePatientReply({ caseId: CASE, from: 'patient@test.example', body: `APPROVE ${forged}\nAPPROVE ${otherDraft}` }, deps);
    expect(r).toEqual({ approvals: [{ draftId: '?', result: 'bad_signature' }, { draftId: 'draft-9', result: 'not_this_agents_draft' }], chattedWith: null });
    expect(approved).toEqual([]);
    expect(replyInstructionText('> quoted\nhello')).toBe('hello');
  });
});
