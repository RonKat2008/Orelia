import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listed: { followUps: [] as { sentAt: string | null; approvedAt: string | null }[], notification: { optIn: true, patientEmail: 'patient@example.com', homeState: 'IL', lastSentAt: null as string | null, lastDigestOn: null as string | null } },
  recordNotify: vi.fn(async () => {}),
  cancelPending: vi.fn(async () => ({ revoked: 1 })),
  resolve: vi.fn(async () => ({ action: 'hold', reason: 'x' })),
  notifyPending: vi.fn(),
  agentMailNotifier: vi.fn(() => ({ send: async () => ({ id: 'real' }) })),
  clientKeys: [] as string[],
}));

vi.mock('../../lib/outreach/follow-up-plan', () => ({
  PostgresFollowUpPlan: class {
    list = async () => h.listed;
    recordNotify = h.recordNotify;
    cancelPending = h.cancelPending;
  },
  resolvePreapprovedSend: h.resolve,
}));
vi.mock('../../lib/notify/service', async (orig) => ({ ...(await orig<typeof import('../../lib/notify/service')>()), notifyPending: h.notifyPending }));
vi.mock('../../lib/notify/agentmail', () => ({ agentMailNotifier: h.agentMailNotifier }));
vi.mock('agentmail', () => ({ AgentMailClient: class { constructor(o: { apiKey: string }) { h.clientKeys.push(o.apiKey); } } }));
vi.mock('../../db/client', () => ({ getDb: () => ({}) }));

import { createDefaultDeps, createDurableDeps } from '../../lib/workflows/default-deps';
import { InMemoryContactContextStore, PostgresContactContextStore } from '../../lib/workflows/contact-store';

const send = vi.fn(async () => ({ providerRef: 'ref' }));
const pgDeps = (env: Record<string, string | undefined> = {}) => createDurableDeps({ store: new PostgresContactContextStore(), send, env });

beforeEach(() => {
  h.listed.followUps = []; h.listed.notification.optIn = true; h.listed.notification.lastSentAt = null;
  h.recordNotify.mockClear(); h.cancelPending.mockClear(); h.resolve.mockClear(); h.notifyPending.mockReset(); h.agentMailNotifier.mockClear(); h.clientKeys.length = 0;
});

describe('createDurableDeps', () => {
  it('omits walk-away hooks for non-Postgres stores', async () => {
    const deps = createDurableDeps({ store: new InMemoryContactContextStore(), send, env: {} });
    expect(deps.resolvePreapproved).toBeUndefined();
    expect(deps.cancelPreapproved).toBeUndefined();
    expect(deps.notifyApprovalNeeded).toBeUndefined();
  });
  it('delegates context, draft, approval and thread calls to the store', async () => {
    const store = new InMemoryContactContextStore();
    const deps = createDurableDeps({ store, send, env: {} });
    await deps.saveContext('c1', { ...(await deps.loadContext('c1')), state: 'sent' });
    expect((await deps.loadContext('c1')).state).toBe('sent');
    expect((await deps.draftFollowUp({ contactId: 'c1', caseId: 'x', followUpNumber: 1 })).messageId).toMatch(/^fu-c1-1/);
    expect(await deps.loadMessageApproval('m')).toBeNull();
    expect(await deps.loadThread?.('c1')).toBeNull();
  });
  it('wires resolvePreapproved and cancelPreapproved to the plan', async () => {
    const deps = pgDeps();
    await deps.resolvePreapproved?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1 });
    expect(h.resolve).toHaveBeenCalledWith(expect.anything(), { contactId: 'c1', caseId: 'case1', followUpNumber: 1 });
    expect(await deps.cancelPreapproved?.({ contactId: 'c1', reason: 'reply' })).toBeUndefined();
    expect(h.cancelPending).toHaveBeenCalledWith('c1', 'reply');
  });

  describe('notifyApprovalNeeded', () => {
    const base = { WAYFINDER_NOTIFY_LINK_SECRET: 'synthetic-secret', WAYFINDER_NOTIFY_INBOX_ID: 'inbox-1' };
    it('does nothing without a link secret', async () => {
      await pgDeps({ WAYFINDER_NOTIFY_INBOX_ID: 'inbox-1' }).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      expect(h.notifyPending).not.toHaveBeenCalled();
    });
    it('does nothing when the patient has not opted in', async () => {
      h.listed.notification.optIn = false;
      await pgDeps(base).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      expect(h.notifyPending).not.toHaveBeenCalled();
    });
    it('does nothing without an inbox id', async () => {
      await pgDeps({ WAYFINDER_NOTIFY_LINK_SECRET: 'synthetic-secret' }).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      expect(h.notifyPending).not.toHaveBeenCalled();
    });
    it('reports at least one pending item and records the notification when sent', async () => {
      h.notifyPending.mockResolvedValue({ sent: true, lastSentAt: '2026-10-22T00:00:00.000Z', lastDigestOn: null });
      h.listed.followUps = [{ sentAt: null, approvedAt: null }, { sentAt: null, approvedAt: null }, { sentAt: 'x', approvedAt: null }, { sentAt: null, approvedAt: 'y' }];
      h.listed.notification.lastSentAt = '2026-10-21T00:00:00.000Z';
      await pgDeps({ ...base, OUTBOUND_ALLOWLIST: 'patient@example.com', WAYFINDER_APP_BASE_URL: 'https://app.example.org' }).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      const req = h.notifyPending.mock.calls[0][0];
      expect(req).toMatchObject({ pendingCount: 2, appBaseUrl: 'https://app.example.org', kind: 'immediate', allowlist: ['patient@example.com'] });
      expect(req.state.lastSentAt).toEqual(new Date('2026-10-21T00:00:00.000Z'));
      expect(h.recordNotify).toHaveBeenCalledWith('case1', expect.objectContaining({ sent: true }));
    });
    it('clamps pending to 1, defaults the base url, uses an unconfigured mailer without an API key, and skips recording when not sent', async () => {
      h.notifyPending.mockResolvedValue({ sent: false, reason: 'throttled' });
      await pgDeps(base).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      const req = h.notifyPending.mock.calls[0][0];
      expect(req.pendingCount).toBe(1);
      expect(req.appBaseUrl).toBe('http://localhost:3000');
      expect(req.state.lastSentAt).toBeNull();
      expect(await req.mailer.send()).toEqual({ id: 'unconfigured' });
      expect(h.agentMailNotifier).not.toHaveBeenCalled();
      expect(h.recordNotify).not.toHaveBeenCalled();
    });
    it('builds the real AgentMail notifier when both inbox and API key are set', async () => {
      h.notifyPending.mockResolvedValue({ sent: false });
      await pgDeps({ ...base, AGENTMAIL_API_KEY: 'synthetic-key' }).notifyApprovalNeeded?.({ contactId: 'c1', caseId: 'case1', followUpNumber: 1, reason: 'r' });
      expect(h.clientKeys).toEqual(['synthetic-key']);
      expect(h.agentMailNotifier).toHaveBeenCalledWith(expect.anything(), 'inbox-1');
    });
  });
});

describe('process.env defaults', () => {
  it('createDurableDeps and createDefaultDeps fall back to process.env', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const durable = createDurableDeps({ store: new InMemoryContactContextStore(), send });
    expect(durable.clock.scale).toBeGreaterThanOrEqual(1);
    expect(createDefaultDeps().resolvePreapproved).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe('createDefaultDeps', () => {
  afterEach(() => { vi.doUnmock('../../lib/outreach/channel-wiring'); vi.resetModules(); });

  describe('without DATABASE_URL (in memory)', () => {
    it('persists contexts, hands out unique draft ids, has no approvals, and never sends', async () => {
      const deps = createDefaultDeps({});
      const fresh = await deps.loadContext('c1');
      expect(fresh.state).toBe('drafted');
      await deps.saveContext('c1', { ...fresh, state: 'sent' });
      expect((await deps.loadContext('c1')).state).toBe('sent');
      const a = await deps.draftFollowUp({ contactId: 'c1', caseId: 'x', followUpNumber: 1 });
      const b = await deps.draftFollowUp({ contactId: 'c1', caseId: 'x', followUpNumber: 1 });
      expect(a.messageId).not.toBe(b.messageId);
      expect(await deps.loadMessageApproval('m')).toBeNull();
      await expect(deps.send({ contactId: 'c1', caseId: 'x', messageId: 'm', kind: 'follow_up' })).rejects.toThrow(/not wired/);
    });
    it('does not expose walk-away hooks', () => {
      expect(createDefaultDeps({}).resolvePreapproved).toBeUndefined();
    });
  });

  describe('with DATABASE_URL (durable)', () => {
    const env = { DATABASE_URL: 'postgres://synthetic.invalid/db' };
    const input = { contactId: 'c1', caseId: 'x', messageId: 'm', kind: 'follow_up' as const };
    it('exposes walk-away hooks', () => {
      expect(createDefaultDeps(env).resolvePreapproved).toBeTypeOf('function');
    });
    it('sends through the follow-up sender created by channel-wiring', async () => {
      const inner = vi.fn(async () => ({ providerRef: 'sent-1' }));
      const create = vi.fn(() => inner);
      vi.doMock('../../lib/outreach/channel-wiring', () => ({ createFollowUpSender: create }));
      expect(await createDefaultDeps(env).send(input)).toEqual({ providerRef: 'sent-1' });
      expect(create).toHaveBeenCalledWith({ env });
      expect(inner).toHaveBeenCalledWith(input);
    });
    it('fails closed with a clear error when channel-wiring does not export the sender', async () => {
      vi.doMock('../../lib/outreach/channel-wiring', () => ({ createFollowUpSender: undefined }));
      await expect(createDefaultDeps(env).send(input)).rejects.toThrow(/does not export createFollowUpSender/);
    });
    it('fails closed with a clear error when channel-wiring cannot be imported', async () => {
      vi.doMock('../../lib/outreach/channel-wiring', () => { throw new Error('boom'); });
      await expect(createDefaultDeps(env).send(input)).rejects.toThrow(/Follow-up sender unavailable: lib\/outreach\/channel-wiring could not be loaded/);
    });
  });
});
