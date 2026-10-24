/* eslint-disable @typescript-eslint/no-explicit-any -- FakeStep mirrors loosely typed engine payloads */
import { describe, expect, it, vi } from 'vitest';
import {
  CONTACT_APPROVED,
  CONTACT_REPLY,
  CONTACT_RESTART,
  FOLLOW_UP_APPROVED,
  FOLLOW_UP_DRAFTED,
  createConnectionRestartWorkflow,
  createConnectionWorkflow,
  createFollowUpSendWorkflow,
  createStalledRevivalWorkflow,
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
  ids = new Set<string>();
  ran: string[] = [];
  events: { id: string; payload: any }[] = [];
  constructor(public script: Record<string, Scripted> = {}) {}
  private claim(id: string) {
    if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    this.ids.add(id);
  }
  async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    this.claim(id);
    this.ran.push(id);
    const v = await fn();
    return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T;
  }
  async waitForEvent<E = unknown>(id: string, opts: any): Promise<E | null> {
    this.claim(id);
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

function setup(start: Partial<ContactContext> = {}, overrides: Partial<ConnectionDeps> = {}) {
  const store = new Map<string, ContactContext>();
  store.set(CID, { ...initialContext(), ...start });
  const send = vi.fn<(input: any) => Promise<{ providerRef: string }>>(async () => ({ providerRef: 'ref' }));
  const draftFollowUp = vi.fn(async (i: any) => ({ messageId: `draft-${i.followUpNumber}` }));
  const approvals = new Map<string, string>([
    ['m-1', NOW.toISOString()],
    ['pre-1', NOW.toISOString()],
    ['pre-2', NOW.toISOString()],
    ['draft-1', NOW.toISOString()],
  ]);
  const deps: ConnectionDeps = {
    clock: { now: () => NOW, scale: 1 },
    send,
    draftFollowUp,
    loadMessageApproval: async (id) => approvals.get(id) ?? null,
    loadContext: async (id) => structuredClone(store.get(id)!),
    saveContext: async (id, ctx) => {
      store.set(id, structuredClone(ctx));
    },
    ...overrides,
  };
  return { store, send, draftFollowUp, approvals, deps };
}

const approved = {
  name: CONTACT_APPROVED,
  data: { contactId: CID, caseId: CASE, messageId: 'm-1', approvedAt: NOW.toISOString() },
};
const reply = { name: CONTACT_REPLY, data: { contactId: CID, caseId: CASE } };
const sentAt = new Date('2026-03-02T14:00:00Z');
const sentState = { state: 'sent' as const, firstSentAt: sentAt, lastOutboundAt: sentAt };

describe('connection workflow input validation', () => {
  it('refuses an event with no data at all', async () => {
    const c = setup();
    await expect(
      createConnectionWorkflow(c.deps).handler({ event: { name: CONTACT_APPROVED } as any, step: new FakeStep() }),
    ).rejects.toThrow(/approvedAt/);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('refuses a non-string approvedAt', async () => {
    const c = setup();
    await expect(
      createConnectionWorkflow(c.deps).handler({
        event: { name: CONTACT_APPROVED, data: { ...approved.data, approvedAt: 12345 } },
        step: new FakeStep(),
      }),
    ).rejects.toThrow(/approvedAt/);
  });

  it('refuses an unparseable approvedAt string', async () => {
    const c = setup();
    await expect(
      createConnectionWorkflow(c.deps).handler({
        event: { name: CONTACT_APPROVED, data: { ...approved.data, approvedAt: 'not-a-date' } },
        step: new FakeStep(),
      }),
    ).rejects.toThrow(/approvedAt/);
  });

  it.each([
    ['contactId missing', { contactId: undefined }],
    ['contactId empty', { contactId: '' }],
    ['caseId missing', { caseId: undefined }],
    ['caseId empty', { caseId: '' }],
    ['messageId missing', { messageId: undefined }],
    ['messageId not a string', { messageId: 7 }],
  ])('refuses when %s', async (_name, patch) => {
    const c = setup();
    await expect(
      createConnectionWorkflow(c.deps).handler({
        event: { name: CONTACT_APPROVED, data: { ...approved.data, ...patch } },
        step: new FakeStep(),
      }),
    ).rejects.toThrow(/missing contactId, caseId or messageId/);
    expect(c.send).not.toHaveBeenCalled();
  });
});

describe('connection workflow initial send', () => {
  it('returns the current state without sending when the contact is already past sent', async () => {
    const c = setup({ state: 'replied', firstSentAt: sentAt });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step: new FakeStep() });
    expect(out).toEqual({ outcome: 'replied' });
    expect(c.send).not.toHaveBeenCalled();
  });

  it('stops with the sent state when firstSentAt is missing', async () => {
    const c = setup({ state: 'sent', firstSentAt: null });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step: new FakeStep() });
    expect(out).toEqual({ outcome: 'sent' });
  });
});

describe('connection workflow out-of-band state changes during a wait', () => {
  it('stops with declined and cancels pre-approved follow-ups when declined during the wait', async () => {
    const cancelPreapproved = vi.fn(async () => undefined);
    const c = setup(sentState, { cancelPreapproved });
    const step = new FakeStep({
      'wait-reply-followUp1': () => {
        c.store.set(CID, { ...c.store.get(CID)!, state: 'declined' });
        return null;
      },
    });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'declined' });
    expect(cancelPreapproved).toHaveBeenCalledWith({ contactId: CID, reason: 'decline' });
    expect(c.draftFollowUp).not.toHaveBeenCalled();
  });

  it('stops with replied when a reply landed out of band without the wait event firing', async () => {
    const cancelPreapproved = vi.fn(async () => undefined);
    const c = setup(sentState, { cancelPreapproved });
    const step = new FakeStep({
      'wait-reply-followUp1': () => {
        c.store.set(CID, { ...c.store.get(CID)!, state: 'replied' });
        return null;
      },
    });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(cancelPreapproved).toHaveBeenCalledWith({ contactId: CID, reason: 'reply' });
  });

  it('does not require cancelPreapproved to be wired when declined during the wait', async () => {
    const c = setup(sentState);
    const step = new FakeStep({
      'wait-reply-followUp1': () => {
        c.store.set(CID, { ...c.store.get(CID)!, state: 'declined' });
        return null;
      },
    });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'declined' });
  });

  it('returns the new state at the next gate when a state change happens before the wait', async () => {
    const c = setup(sentState);
    const step = new FakeStep({
      'wait-reply-followUp1': () => {
        c.store.set(CID, { ...c.store.get(CID)!, state: 'appointment_booked' });
        return reply; // a reply arrives, but REPLY_RECEIVED is illegal from appointment_booked
      },
    });
    await expect(createConnectionWorkflow(c.deps).handler({ event: approved, step })).rejects.toThrow(
      /Invalid transition REPLY_RECEIVED from appointment_booked/,
    );
  });

  it('cancels pre-approved follow-ups when a reply is received', async () => {
    const cancelPreapproved = vi.fn(async () => undefined);
    const c = setup(sentState, { cancelPreapproved });
    const step = new FakeStep({ 'wait-reply-followUp1': reply });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(cancelPreapproved).toHaveBeenCalledWith({ contactId: CID, reason: 'reply' });
  });

  it('exits at the check-state gate when the contact left sent between phases', async () => {
    const c = setup(sentState);
    // After follow-up 1 is drafted (contact stays sent), flip to declined before phase 2's gate.
    c.draftFollowUp.mockImplementationOnce(async (i: any) => {
      c.store.set(CID, { ...c.store.get(CID)!, state: 'declined' });
      return { messageId: `draft-${i.followUpNumber}` };
    });
    const step = new FakeStep();
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'declined' });
    expect(step.ran).toContain('check-state-followUp2');
    expect(step.ran).not.toContain('deadline-followUp2');
  });
});

describe('connection workflow walk-away (pre-approved) follow-ups', () => {
  it('sends the pre-approved follow-up in-thread and skips the draft', async () => {
    const thread = { inboxId: 'inb', threadId: 'thr', messageId: 'msg' };
    const resolvePreapproved = vi.fn(async () => ({ action: 'send' as const, messageId: 'pre-1', body: 'hi' }));
    const c = setup(sentState, { resolvePreapproved, loadThread: async () => thread });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(resolvePreapproved).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, followUpNumber: 1 });
    expect(c.send).toHaveBeenCalledWith({
      contactId: CID,
      caseId: CASE,
      messageId: 'pre-1',
      kind: 'follow_up',
      thread,
    });
    expect(c.draftFollowUp).not.toHaveBeenCalled();
    expect(c.store.get(CID)!.followUpsSent).toBe(1);
  });

  it('sends a pre-approved follow-up without a thread when loadThread returns null', async () => {
    const c = setup(sentState, {
      resolvePreapproved: async () => ({ action: 'send', messageId: 'pre-1', body: 'hi' }),
      loadThread: async () => null,
    });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(c.send).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, messageId: 'pre-1', kind: 'follow_up' });
  });

  it('sends a pre-approved follow-up without a thread when loadThread is not wired', async () => {
    const c = setup(sentState, {
      resolvePreapproved: async () => ({ action: 'send', messageId: 'pre-1', body: 'hi' }),
    });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(c.send).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, messageId: 'pre-1', kind: 'follow_up' });
  });

  it('does not send a pre-approved follow-up the database no longer shows as approved, and drafts instead', async () => {
    const c = setup(sentState, {
      resolvePreapproved: async () => ({ action: 'send', messageId: 'unknown-msg', body: 'hi' }),
    });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(c.send).not.toHaveBeenCalled();
    expect(c.draftFollowUp).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, followUpNumber: 1 });
    expect(step.events.map((e) => e.payload.name)).toEqual([FOLLOW_UP_DRAFTED]);
  });

  it('on hold, notifies the patient with the reason and still creates an unapproved draft', async () => {
    const notifyApprovalNeeded = vi.fn(async () => undefined);
    const c = setup(sentState, {
      resolvePreapproved: async () => ({ action: 'hold', reason: 'body changed' }),
      notifyApprovalNeeded,
    });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(notifyApprovalNeeded).toHaveBeenCalledWith({
      contactId: CID,
      caseId: CASE,
      followUpNumber: 1,
      reason: 'body changed',
    });
    expect(c.send).not.toHaveBeenCalled();
    expect(c.draftFollowUp).toHaveBeenCalledTimes(1);
  });

  it('on hold with no notifier wired, still drafts without throwing', async () => {
    const c = setup(sentState, {
      resolvePreapproved: async () => ({ action: 'hold', reason: 'x' }),
    });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(step.ran).toContain('notify-approval-1');
    expect(c.draftFollowUp).toHaveBeenCalledTimes(1);
  });
});

describe('connection workflow late timers', () => {
  it('uses the current time when it is already past the real deadline', async () => {
    const late = new Date('2026-04-15T15:00:00Z');
    const c = setup(sentState, { clock: { now: () => late, scale: 1 } });
    const step = new FakeStep({ 'wait-reply-followUp2': reply });
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'replied' });
    expect(c.draftFollowUp).toHaveBeenCalledTimes(1);
    expect(c.store.get(CID)!.followUpsDue).toBe(1);
  });
});

describe('connection workflow stall', () => {
  it('walks the full cadence with pre-approved sends for both follow-ups and then stalls', async () => {
    const c = setup(sentState, {
      resolvePreapproved: async ({ followUpNumber }) => ({
        action: 'send',
        messageId: `pre-${followUpNumber}`,
        body: 'b',
      }),
    });
    const step = new FakeStep();
    const out = await createConnectionWorkflow(c.deps).handler({ event: approved, step });
    expect(out).toEqual({ outcome: 'stalled' });
    expect(c.send.mock.calls.map((a) => a[0].messageId)).toEqual(['pre-1', 'pre-2']);
    expect(c.draftFollowUp).not.toHaveBeenCalled();
    expect(c.store.get(CID)!.state).toBe('stalled');
  });
});

describe('stalled revival workflow', () => {
  const ev = (data: Record<string, unknown> | undefined) => ({ name: CONTACT_REPLY, data }) as any;

  it('throws on an event with no data', async () => {
    const c = setup();
    await expect(createStalledRevivalWorkflow(c.deps).handler({ event: ev(undefined), step: new FakeStep() })).rejects.toThrow(
      /missing contactId or caseId/,
    );
  });

  it.each([
    ['contactId missing', { caseId: CASE }],
    ['contactId empty', { contactId: '', caseId: CASE }],
    ['caseId missing', { contactId: CID }],
    ['caseId empty', { contactId: CID, caseId: '' }],
  ])('throws when %s', async (_n, data) => {
    const c = setup();
    await expect(createStalledRevivalWorkflow(c.deps).handler({ event: ev(data), step: new FakeStep() })).rejects.toThrow(
      /missing contactId or caseId/,
    );
  });

  it('cancels pre-approved follow-ups and restarts keyed by dedupeKey', async () => {
    const cancelPreapproved = vi.fn(async () => undefined);
    const c = setup({ state: 'stalled', firstSentAt: sentAt }, { cancelPreapproved });
    const step = new FakeStep();
    await createStalledRevivalWorkflow(c.deps).handler({
      event: ev({ contactId: CID, caseId: CASE, dedupeKey: 'dk', messageId: 'pm' }),
      step,
    });
    expect(cancelPreapproved).toHaveBeenCalledWith({ contactId: CID, reason: 'reply' });
    expect(step.events[0].payload).toEqual({
      name: CONTACT_RESTART,
      data: { contactId: CID, caseId: CASE, restartKey: 'dk', messageId: 'pm' },
    });
  });

  it('falls back to messageId, then contactId, for the restart key', async () => {
    const c = setup({ state: 'stalled', firstSentAt: sentAt });
    const s1 = new FakeStep();
    await createStalledRevivalWorkflow(c.deps).handler({
      event: ev({ contactId: CID, caseId: CASE, messageId: 'only-msg' }),
      step: s1,
    });
    expect(s1.events[0].payload.data).toMatchObject({ restartKey: 'only-msg', messageId: 'only-msg' });

    c.store.set(CID, { ...initialContext(), state: 'stalled', firstSentAt: sentAt });
    const s2 = new FakeStep();
    await createStalledRevivalWorkflow(c.deps).handler({ event: ev({ contactId: CID, caseId: CASE }), step: s2 });
    expect(s2.events[0].payload.data).toEqual({ contactId: CID, caseId: CASE, restartKey: CID, messageId: null });
  });
});

describe('connection restart workflow', () => {
  const ev = (data: Record<string, unknown> | undefined) => ({ name: CONTACT_RESTART, data }) as any;

  it('throws on an event with no data', async () => {
    const c = setup();
    await expect(createConnectionRestartWorkflow(c.deps).handler({ event: ev(undefined), step: new FakeStep() })).rejects.toThrow(
      /missing contactId or caseId/,
    );
  });

  it.each([
    ['contactId missing', { caseId: CASE }],
    ['contactId empty', { contactId: '', caseId: CASE }],
    ['caseId missing', { contactId: CID }],
    ['caseId empty', { contactId: CID, caseId: '' }],
  ])('throws when %s', async (_n, data) => {
    const c = setup();
    await expect(createConnectionRestartWorkflow(c.deps).handler({ event: ev(data), step: new FakeStep() })).rejects.toThrow(
      /missing contactId or caseId/,
    );
  });

  it('uses a placeholder message id when the restart event carries none, and sends nothing', async () => {
    const c = setup({ state: 'replied', firstSentAt: sentAt });
    const out = await createConnectionRestartWorkflow(c.deps).handler({
      event: ev({ contactId: CID, caseId: CASE, messageId: null }),
      step: new FakeStep(),
    });
    expect(out).toEqual({ outcome: 'replied' });
    expect(c.send).not.toHaveBeenCalled();
  });
});

describe('follow-up send workflow', () => {
  const fu = (data: Record<string, unknown> | undefined) => ({ name: FOLLOW_UP_APPROVED, data }) as any;
  const base = { contactId: CID, caseId: CASE, messageId: 'draft-1', approvedAt: NOW.toISOString() };

  it('refuses an event with no data', async () => {
    const c = setup();
    await expect(createFollowUpSendWorkflow(c.deps).handler({ event: fu(undefined), step: new FakeStep() })).rejects.toThrow(
      /approvedAt/,
    );
  });

  it('refuses a non-string approvedAt', async () => {
    const c = setup();
    await expect(
      createFollowUpSendWorkflow(c.deps).handler({ event: fu({ ...base, approvedAt: 1 }), step: new FakeStep() }),
    ).rejects.toThrow(/approvedAt/);
  });

  it('refuses an unparseable approvedAt', async () => {
    const c = setup();
    await expect(
      createFollowUpSendWorkflow(c.deps).handler({ event: fu({ ...base, approvedAt: 'garbage' }), step: new FakeStep() }),
    ).rejects.toThrow(/approvedAt/);
  });

  it.each([
    ['contactId missing', { contactId: undefined }],
    ['contactId empty', { contactId: '' }],
    ['caseId missing', { caseId: undefined }],
    ['caseId empty', { caseId: '' }],
    ['messageId missing', { messageId: undefined }],
    ['messageId empty', { messageId: '' }],
  ])('refuses when %s', async (_n, patch) => {
    const c = setup();
    await expect(
      createFollowUpSendWorkflow(c.deps).handler({ event: fu({ ...base, ...patch }), step: new FakeStep() }),
    ).rejects.toThrow(/missing contactId, caseId or messageId/);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('skips when no follow-up is due, even for an approved message', async () => {
    const c = setup({ ...sentState, followUpsDue: 0, followUpsSent: 0 });
    const out: any = await createFollowUpSendWorkflow(c.deps).handler({ event: fu(base), step: new FakeStep() });
    expect(out.skipped).toMatch(/no unsent follow-up is due/);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('sends without a thread when loadThread resolves null', async () => {
    const c = setup({ ...sentState, followUpsDue: 1, followUpsSent: 0 }, { loadThread: async () => null });
    const out: any = await createFollowUpSendWorkflow(c.deps).handler({ event: fu(base), step: new FakeStep() });
    expect(out).toEqual({ sent: true, providerRef: 'ref' });
    expect(c.send).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, messageId: 'draft-1', kind: 'follow_up' });
  });
});
