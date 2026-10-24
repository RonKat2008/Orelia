import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL_TIMEOUT,
  CONTACT_APPROVED,
  CONTACT_CREATED,
  CONTACT_REPLY,
  CONTACT_STALLED,
  FOLLOW_UP_APPROVED,
  FOLLOW_UP_DRAFTED,
  createConnectionWorkflow,
  createFollowUpSendWorkflow,
  followUpDeadlines,
  initialContext,
  type ConnectionDeps,
  type ContactContext,
  type WorkflowStep,
} from '../../lib/workflows';

const NOW = new Date('2026-03-02T15:00:00Z'); // Monday
const CID = 'c-1';
const CASE = 'case-1';

type Scripted = unknown | null | ((opts: any) => unknown | null);

class FakeStep implements WorkflowStep {
  memo = new Map<string, unknown>();
  ids = new Set<string>();
  waits: { id: string; opts: any }[] = [];
  events: { id: string; payload: any }[] = [];
  constructor(public script: Record<string, Scripted> = {}) {}
  private claim(id: string) {
    if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    this.ids.add(id);
  }
  async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    this.claim(id);
    const v = await fn();
    this.memo.set(id, v);
    // Inngest round-trips results through JSON; emulate to catch Date leaks.
    return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T;
  }
  async waitForEvent<E = unknown>(id: string, opts: any): Promise<E | null> {
    this.claim(id);
    this.waits.push({ id, opts });
    const s = this.script[id];
    const v = typeof s === 'function' ? (s as any)(opts) : s;
    return (v === undefined ? null : v) as E | null;
  }
  async sendEvent(id: string, payload: any) {
    this.claim(id);
    this.events.push({ id, payload });
    return {};
  }
}

function setup(scale = 1) {
  const store = new Map<string, ContactContext>();
  store.set(CID, initialContext());
  const send = vi.fn(async (_i: any) => ({ providerRef: 'ref' }));
  const draftFollowUp = vi.fn(async (i: any) => ({ messageId: `draft-${i.followUpNumber}` }));
  const deps: ConnectionDeps = {
    clock: { now: () => NOW, scale },
    send,
    draftFollowUp,
    loadContext: async (id) => structuredClone(store.get(id)!),
    saveContext: async (id, ctx) => {
      store.set(id, structuredClone(ctx));
    },
  };
  return { store, send, draftFollowUp, deps };
}

const created = { name: CONTACT_CREATED, data: { contactId: CID, caseId: CASE } };
const approved = {
  name: CONTACT_APPROVED,
  data: { contactId: CID, caseId: CASE, messageId: 'm-1', approvedAt: NOW.toISOString() },
};
const reply = { name: CONTACT_REPLY, data: { contactId: CID, caseId: CASE } };

describe('connection workflow', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('approval timeout sends nothing', async () => {
    const step = new FakeStep({ 'wait-approval': null });
    const wf = createConnectionWorkflow(ctx.deps);
    expect(wf.id).toBe('contact-connection');
    expect(wf.trigger.event).toBe(CONTACT_CREATED);
    const out = await wf.handler({ event: created, step });
    expect(out).toEqual({ outcome: 'approval_timeout' });
    expect(ctx.send).not.toHaveBeenCalled();
    expect(step.waits[0].opts.timeout).toBe(APPROVAL_TIMEOUT);
    expect(step.waits[0].opts.event).toBe(CONTACT_APPROVED);
  });

  it('refuses to send when approval lacks approvedAt', async () => {
    const step = new FakeStep({
      'wait-approval': { data: { contactId: CID, caseId: CASE, messageId: 'm-1' } },
    });
    await expect(
      createConnectionWorkflow(ctx.deps).handler({ event: created, step }),
    ).rejects.toThrow(/approvedAt/);
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it('reply after initial send -> replied; initial sent once', async () => {
    const step = new FakeStep({ 'wait-approval': approved, 'wait-reply-followUp1': reply });
    const out = await createConnectionWorkflow(ctx.deps).handler({ event: created, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledWith({
      contactId: CID,
      caseId: CASE,
      messageId: 'm-1',
      kind: 'initial',
    });
    expect(ctx.store.get(CID)!.state).toBe('replied');
    expect(ctx.draftFollowUp).not.toHaveBeenCalled();
  });

  it('no reply at all -> two follow-up drafts, one send, stalled', async () => {
    const step = new FakeStep({ 'wait-approval': approved });
    const out = await createConnectionWorkflow(ctx.deps).handler({ event: created, step });
    expect(out).toEqual({ outcome: 'stalled' });
    expect(ctx.draftFollowUp.mock.calls.map((c) => c[0].followUpNumber)).toEqual([1, 2]);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.send.mock.calls[0][0].kind).toBe('initial');
    expect(ctx.store.get(CID)!.state).toBe('stalled');
    const names = step.events.map((e) => e.payload.name);
    expect(names).toEqual([FOLLOW_UP_DRAFTED, FOLLOW_UP_DRAFTED, CONTACT_STALLED]);
    expect(step.events[0].payload.data).toMatchObject({ contactId: CID, messageId: 'draft-1', followUpNumber: 1 });
    expect(step.events[2].payload.data).toEqual({ contactId: CID, caseId: CASE });
  });

  it('reply after the day-3 follow-up draft -> replied', async () => {
    const step = new FakeStep({ 'wait-approval': approved, 'wait-reply-followUp2': reply });
    const out = await createConnectionWorkflow(ctx.deps).handler({ event: created, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(ctx.draftFollowUp).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledTimes(1);
    expect(ctx.store.get(CID)!.state).toBe('replied');
  });

  it('timeouts equal the real deadlines at scale 1', async () => {
    const step = new FakeStep({ 'wait-approval': approved });
    await createConnectionWorkflow(ctx.deps).handler({ event: created, step });
    const d = followUpDeadlines(NOW);
    const t = step.waits.filter((w) => w.id.startsWith('wait-reply-')).map((w) => w.opts.timeout);
    expect(t.map((x: Date) => x.getTime())).toEqual([
      d.followUp1.getTime(),
      d.followUp2.getTime(),
      d.stall.getTime(),
    ]);
  });

  it('timeouts are compressed at scale 1440 (exact ms)', async () => {
    const c = setup(1440);
    const step = new FakeStep({ 'wait-approval': approved });
    const out = await createConnectionWorkflow(c.deps).handler({ event: created, step });
    expect(out).toEqual({ outcome: 'stalled' }); // unscaled "now" used for transitions
    const d = followUpDeadlines(NOW);
    const t = step.waits.filter((w) => w.id.startsWith('wait-reply-')).map((w) => w.opts.timeout.getTime());
    expect(t).toEqual(
      [d.followUp1, d.followUp2, d.stall].map((x) => NOW.getTime() + (x.getTime() - NOW.getTime()) / 1440),
    );
    expect(t[0]).toBeLessThan(NOW.getTime() + 24 * 3600_000);
  });

  it('the if expression contains the JSON-escaped contactId', async () => {
    const evil = 'a"b\\c';
    const c = setup();
    c.store.set(evil, initialContext());
    const step = new FakeStep({ 'wait-approval': null });
    await createConnectionWorkflow(c.deps).handler({
      event: { name: CONTACT_CREATED, data: { contactId: evil, caseId: CASE } },
      step,
    });
    expect(step.waits[0].opts.if).toBe(`async.data.contactId == ${JSON.stringify(evil)}`);
    const step2 = new FakeStep({ 'wait-approval': approved });
    await createConnectionWorkflow(ctx.deps).handler({ event: created, step: step2 });
    for (const w of step2.waits) expect(w.opts.if).toBe(`async.data.contactId == "${CID}"`);
  });

  it('stops early when the contact is declined out of band', async () => {
    ctx.draftFollowUp.mockImplementationOnce(async (i: any) => {
      ctx.store.set(CID, { ...ctx.store.get(CID)!, state: 'declined' });
      return { messageId: `draft-${i.followUpNumber}` };
    });
    const step = new FakeStep({ 'wait-approval': approved });
    const out = await createConnectionWorkflow(ctx.deps).handler({ event: created, step });
    expect(out).toEqual({ outcome: 'declined' });
    expect(ctx.draftFollowUp).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledTimes(1);
  });

  it('does not re-send the initial message if already sent (retry safety)', async () => {
    const { deps, store, send } = ctx;
    const step0 = new FakeStep({ 'wait-approval': approved, 'wait-reply-followUp1': reply });
    await createConnectionWorkflow(deps).handler({ event: created, step: step0 });
    // simulate replay with state already 'sent'
    store.set(CID, { ...store.get(CID)!, state: 'sent' });
    const step1 = new FakeStep({ 'wait-approval': approved, 'wait-reply-followUp1': reply });
    await createConnectionWorkflow(deps).handler({ event: created, step: step1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('follow-up send workflow', () => {
  const approvedFU = {
    name: FOLLOW_UP_APPROVED,
    data: { contactId: CID, caseId: CASE, messageId: 'draft-1', approvedAt: NOW.toISOString() },
  };

  it('unapproved event throws without sending', async () => {
    const c = setup();
    const wf = createFollowUpSendWorkflow(c.deps);
    expect(wf.id).toBe('contact-follow-up-send');
    expect(wf.trigger.event).toBe(FOLLOW_UP_APPROVED);
    await expect(
      wf.handler({
        event: { name: FOLLOW_UP_APPROVED, data: { contactId: CID, caseId: CASE, messageId: 'd' } },
        step: new FakeStep(),
      }),
    ).rejects.toThrow(/approvedAt/);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('approved sends once as follow_up; a second approval is skipped', async () => {
    const c = setup();
    // Reach state 'sent' with followUpsDue = 1: initial send, then follow-up 1 due, then
    // pause (decline-free) by stopping at the follow-up 2 wait via a thrown sentinel.
    const stop = new Error('stop');
    const step = new FakeStep({
      'wait-approval': approved,
      'wait-reply-followUp2': () => {
        throw stop;
      },
    });
    await expect(createConnectionWorkflow(c.deps).handler({ event: created, step })).rejects.toBe(stop);
    expect(c.store.get(CID)).toMatchObject({ state: 'sent', followUpsDue: 1, followUpsSent: 0 });
    expect(c.send).toHaveBeenCalledTimes(1);

    const wf = createFollowUpSendWorkflow(c.deps);
    const r1: any = await wf.handler({ event: approvedFU, step: new FakeStep() });
    expect(r1.sent).toBe(true);
    expect(c.send).toHaveBeenCalledTimes(2);
    expect(c.send).toHaveBeenLastCalledWith({
      contactId: CID,
      caseId: CASE,
      messageId: 'draft-1',
      kind: 'follow_up',
    });
    expect(c.store.get(CID)!.followUpsSent).toBe(1);

    const r2: any = await wf.handler({ event: approvedFU, step: new FakeStep() });
    expect(r2.skipped).toBeTruthy();
    expect(c.send).toHaveBeenCalledTimes(2);
  });

  it('skips when the contact is not in sent state', async () => {
    const c = setup(); // state drafted
    const r: any = await createFollowUpSendWorkflow(c.deps).handler({
      event: approvedFU,
      step: new FakeStep(),
    });
    expect(r.skipped).toBeTruthy();
    expect(c.send).not.toHaveBeenCalled();
  });
});
