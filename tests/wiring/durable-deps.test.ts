/* eslint-disable @typescript-eslint/no-explicit-any -- FakeStep mirrors loosely typed engine payloads */
import { describe, expect, it, vi } from 'vitest';
import {
  contactApprovedEvent,
  createConnectionWorkflow,
  createFollowUpSendWorkflow,
  followUpApprovedEvent,
  initialContext,
  type WorkflowStep,
} from '../../lib/workflows';
import { createDefaultDeps, createDurableDeps } from '../../lib/workflows/default-deps';
import { InMemoryContactContextStore } from '../../lib/workflows/contact-store';

const NOW = new Date('2026-03-02T15:00:00Z');
const CID = 'c-1';
const CASE = 'case-1';

class FakeStep implements WorkflowStep {
  ids = new Set<string>();
  waits: string[] = [];
  events: any[] = [];
  constructor(private script: Record<string, unknown> = {}) {}
  private claim(id: string) {
    if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    this.ids.add(id);
  }
  async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    this.claim(id);
    const v = await fn();
    return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T;
  }
  async waitForEvent<E = unknown>(id: string): Promise<E | null> {
    this.claim(id);
    this.waits.push(id);
    const s = this.script[id];
    if (typeof s === 'function') return (s as () => E)();
    return (s ?? null) as E | null;
  }
  async sendEvent(id: string, payload: any) {
    this.claim(id);
    this.events.push(payload);
    return {};
  }
}

function setup() {
  const store = new InMemoryContactContextStore();
  const sentAt = new Date(NOW.getTime() - 3600_000);
  store.contexts.set(CID, { ...initialContext(), state: 'sent', firstSentAt: sentAt, lastOutboundAt: sentAt });
  store.approvals.set('m-1', NOW.toISOString());
  const send = vi.fn(async (_a?: any) => ({ providerRef: 'ref' }));
  const deps = createDurableDeps({ store, send, env: {} });
  deps.clock = { now: () => NOW, scale: 1 };
  return { store, send, deps };
}

describe('durable deps end to end (in-memory store)', () => {
  const approved = contactApprovedEvent({ contactId: CID, caseId: CASE, messageId: 'm-1', approvedAt: NOW.toISOString() });

  it('approved event with state sent does not send initial; day-3 timeout drafts follow-up once', async () => {
    const { store, send, deps } = setup();
    const stop = new Error('stop');
    const step = new FakeStep({ 'wait-reply-followUp2': () => { throw stop; } });
    await expect(createConnectionWorkflow(deps).handler({ event: approved, step })).rejects.toBe(stop);
    expect(send).not.toHaveBeenCalled();
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]).toMatchObject({ contactId: CID, followUpNumber: 1 });
    expect(step.events[0].data).toMatchObject({ messageId: store.drafts[0].messageId, followUpNumber: 1 });

    // idempotent: asking again returns the same draft
    const again = await store.createFollowUpDraft({ contactId: CID, caseId: CASE, followUpNumber: 1 });
    expect(again.messageId).toBe(store.drafts[0].messageId);
    expect(store.drafts).toHaveLength(1);
    expect((await store.load(CID)).followUpsDue).toBe(1);
  });

  it('approved follow-up calls the injected send once as follow_up', async () => {
    const { store, send, deps } = setup();
    const stop = new Error('stop');
    await expect(
      createConnectionWorkflow(deps).handler({
        event: approved,
        step: new FakeStep({ 'wait-reply-followUp2': () => { throw stop; } }),
      }),
    ).rejects.toBe(stop);
    const messageId = store.drafts[0].messageId;
    store.approvals.set(messageId, NOW.toISOString());
    const fu = followUpApprovedEvent({ contactId: CID, caseId: CASE, messageId, approvedAt: NOW.toISOString() });
    const wf = createFollowUpSendWorkflow(deps);
    const r1: any = await wf.handler({ event: fu, step: new FakeStep() });
    expect(r1.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ contactId: CID, caseId: CASE, messageId, kind: 'follow_up' });
    const r2: any = await wf.handler({ event: fu, step: new FakeStep() });
    expect(r2.skipped).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    expect((await store.load(CID)).followUpsSent).toBe(1);
  });

  it('still-drafted contact: approved event calls send(initial) via the injected function only', async () => {
    const { store, send, deps } = setup();
    store.contexts.set(CID, initialContext());
    await createConnectionWorkflow(deps).handler({
      event: approved,
      step: new FakeStep({ 'wait-reply-followUp1': { data: {} } }),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].kind).toBe('initial');
  });
});

describe('createDefaultDeps', () => {
  it('without DATABASE_URL stays in-memory and refuses to send', async () => {
    const deps = createDefaultDeps({});
    await expect(deps.send({ contactId: 'c', caseId: 'k', messageId: 'm', kind: 'follow_up' })).rejects.toThrow(/not wired/);
  });
  it('with DATABASE_URL builds durable deps without touching the database', () => {
    const deps = createDefaultDeps({ DATABASE_URL: 'postgres://user:pw@localhost/none' });
    expect(typeof deps.loadContext).toBe('function');
    expect(typeof deps.send).toBe('function');
  });
});
