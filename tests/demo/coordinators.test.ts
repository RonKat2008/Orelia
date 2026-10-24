import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import coordSpecs from '../../fixtures/demo/coordinators.json';
import {
  extractAddress,
  parseReplyAllowlist,
  planReplies,
  type Coordinator,
} from '../../scripts/demo/coordinator-engine';
import type { DemoMessage } from '../../scripts/demo/mail';
import { DryRunMail } from '../../scripts/demo/dry-run-mail';
import { loadState, saveState } from '../../scripts/demo/state';
import { runOnce } from '../../scripts/demo-coordinators';

const CASE = 'wayfinder-case@agentmail.test';
const T0 = Date.parse('2026-01-01T00:00:00.000Z');

const coordinators: Coordinator[] = coordSpecs.coordinators.map((c) => ({
  ...(c as Omit<Coordinator, 'inboxId' | 'address'>),
  inboxId: `${c.key}@agentmail.test`,
  address: `${c.key}@agentmail.test`,
}));

function msg(key: string, id: string, over: Partial<DemoMessage> = {}): DemoMessage {
  return {
    messageId: id,
    threadId: `t-${id}`,
    inboxId: `${key}@agentmail.test`,
    from: CASE,
    to: [`${key}@agentmail.test`],
    subject: 'Hello',
    text: 'hi',
    receivedAt: new Date(T0).toISOString(),
    ...over,
  };
}

function plan(received: DemoMessage[], over: Record<string, unknown> = {}) {
  const map = new Map<string, DemoMessage[]>();
  for (const m of received) map.set(m.inboxId, [...(map.get(m.inboxId) ?? []), m]);
  return planReplies({
    coordinators,
    received: map,
    repliedMessageIds: [],
    allowlist: [CASE],
    now: T0,
    timeScale: 1,
    ...over,
  });
}

describe('planReplies', () => {
  it('replies after each scripted delay', () => {
    const all = [msg('slides', 'a'), msg('referral', 'b'), msg('call', 'c')];
    expect(plan(all, { now: T0 + 19_000 }).due).toHaveLength(0);
    expect(plan(all, { now: T0 + 20_000 }).due.map((r) => r.coordinatorKey)).toEqual(['slides']);
    expect(plan(all, { now: T0 + 30_000 }).due.map((r) => r.coordinatorKey)).toEqual([
      'slides',
      'referral',
    ]);
    const d = plan(all, { now: T0 + 40_000 }).due;
    expect(d.map((r) => r.coordinatorKey)).toEqual(['slides', 'referral', 'call']);
    expect(d[0].text).toBe(coordinators.find((c) => c.key === 'slides')!.reply);
  });

  it('silent never replies', () => {
    const r = plan([msg('silent', 's')], { now: T0 + 1e9 });
    expect(r.due).toHaveLength(0);
    expect(r.pending[0].reason).toMatch(/silent/);
  });

  it('skips non-allowlisted senders with a reason', () => {
    const r = plan([msg('slides', 'a', { from: 'someone@hospital.org' })], { now: T0 + 1e6 });
    expect(r.due).toHaveLength(0);
    expect(r.pending[0].reason).toMatch(/not on reply allowlist/);
  });

  it('parses display names and matches case-insensitively', () => {
    expect(extractAddress('"Wayfinder Case" <Wayfinder-Case@AgentMail.test>')).toBe(CASE);
    const r = plan([msg('slides', 'a', { from: '"Wayfinder" <WAYFINDER-CASE@agentmail.test>' })], {
      now: T0 + 20_000,
    });
    expect(r.due).toHaveLength(1);
    expect(r.due[0].to).toBe(CASE);
  });

  it('does not double reply, including follow-ups in the same thread', () => {
    const first = msg('slides', 'a', { threadId: 'T' });
    const follow = msg('slides', 'b', {
      threadId: 'T',
      receivedAt: new Date(T0 + 5000).toISOString(),
    });
    expect(plan([first], { now: T0 + 1e6, repliedMessageIds: ['a'] }).due).toHaveLength(0);
    const r = plan([first, follow], { now: T0 + 1e6, repliedMessageIds: ['a'] });
    expect(r.due).toHaveLength(0);
    // Both unreplied in one pass: only one reply per thread.
    expect(plan([first, follow], { now: T0 + 1e6 }).due).toHaveLength(1);
  });

  it('timeScale compresses delays', () => {
    const m = msg('slides', 'a');
    const r = plan([m], { timeScale: 1440, now: T0 + 15 });
    expect(r.due).toHaveLength(1);
    expect(r.due[0].dueAt - T0).toBeCloseTo(20_000 / 1440, 2);
    expect(plan([m], { timeScale: 1440, now: T0 + 10 }).due).toHaveLength(0);
  });

  it('empty allowlist replies to nobody', () => {
    expect(plan([msg('slides', 'a')], { allowlist: [], now: T0 + 1e6 }).due).toHaveLength(0);
  });
});

describe('parseReplyAllowlist', () => {
  it('prefers DEMO_REPLY_ALLOWLIST', () => {
    expect(
      parseReplyAllowlist({ DEMO_REPLY_ALLOWLIST: 'A@x.test, "B" <b@x.test>', OUTBOUND_ALLOWLIST: 'z@x.test' }),
    ).toEqual(['a@x.test', 'b@x.test']);
  });
  it('falls back to OUTBOUND_ALLOWLIST minus coordinator addresses', () => {
    expect(
      parseReplyAllowlist({ OUTBOUND_ALLOWLIST: 'case@x.test,coord@x.test' }, ['coord@x.test']),
    ).toEqual(['case@x.test']);
  });
  it('is empty when nothing is configured', () => {
    expect(parseReplyAllowlist({})).toEqual([]);
  });
});

describe('runOnce (dry-run)', () => {
  let dir: string;
  let prev: string | undefined;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-coord-'));
    prev = process.env.WAYFINDER_DEMO_STATE;
    process.env.WAYFINDER_DEMO_STATE = path.join(dir, 'state.json');
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.WAYFINDER_DEMO_STATE;
    else process.env.WAYFINDER_DEMO_STATE = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sends scripted replies and persists repliedMessageIds', async () => {
    const mail = new DryRunMail();
    const seeded: Coordinator[] = [];
    for (const spec of coordSpecs.coordinators) {
      const inbox = await mail.createInbox({ username: spec.username, displayName: spec.displayName });
      seeded.push({ ...(spec as Coordinator), ...inbox });
    }
    saveState({
      mode: 'dry-run',
      createdAt: new Date(T0).toISOString(),
      coordinators: seeded,
      caseId: null,
      repliedMessageIds: [],
    });
    for (const c of seeded) {
      await mail.deliver(c.address, { from: CASE, subject: 'Hello', text: 'hi' });
    }
    const env = { DEMO_REPLY_ALLOWLIST: CASE };
    const deps = {
      mail,
      loadState,
      saveState,
      env,
      log: () => {},
      now: () => Date.now() + 60_000,
    };
    const res = await runOnce(deps);
    expect(res.replied).toBe(3);
    const sent = mail.sent();
    expect(sent).toHaveLength(3);
    const texts = new Set(sent.map((s) => s.text));
    for (const c of seeded.filter((c) => c.reply)) expect(texts.has(c.reply!)).toBe(true);
    expect(loadState()!.repliedMessageIds).toHaveLength(3);
    // Second pass sends nothing.
    expect((await runOnce(deps)).replied).toBe(0);
    expect(mail.sent()).toHaveLength(3);
  });
});

describe('planReplies notBefore (borrowed inboxes)', () => {
  it('ignores mail received before the demo was seeded', () => {
    const old = msg('referral', 'old', { receivedAt: new Date(T0 - 60_000).toISOString() });
    const fresh = msg('referral', 'new', { receivedAt: new Date(T0).toISOString() });
    const p = plan([old, fresh], { now: T0 + 3_600_000, notBefore: T0 });
    expect(p.due.map((d) => d.messageId)).toEqual(['new']);
  });
});

describe('one coordinator inbox serving several contacts', () => {
  it('answers each contact thread separately and tags the reply with its own thread', () => {
    const t = [msg('slides', 'a', { threadId: 'thr-aaaa1111' }), msg('slides', 'b', { threadId: 'thr-bbbb2222' })];
    const due = plan(t, { now: T0 + 60_000 }).due;
    expect(due.map((r) => r.messageId)).toEqual(['a', 'b']);
    expect(due.map((r) => r.threadId)).toEqual(['thr-aaaa1111', 'thr-bbbb2222']);
    expect(due[0].text).toContain('AAAA1111');
    expect(due[1].text).toContain('BBBB2222');
    expect(due[0].text).not.toBe(due[1].text);
  });

  it('does not re-answer a thread and leaves a lone thread untagged', () => {
    const t = [msg('slides', 'a', { threadId: 'thr-1' }), msg('slides', 'b', { threadId: 'thr-2' })];
    expect(plan(t, { now: T0 + 60_000, repliedMessageIds: ['a'] }).due.map((r) => r.messageId)).toEqual(['b']);
    const solo = plan([msg('slides', 'a')], { now: T0 + 60_000 }).due[0];
    expect(solo.text).toBe(coordinators.find((c) => c.key === 'slides')!.reply);
  });
});
