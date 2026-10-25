import { describe, expect, it, vi } from 'vitest';
import { DEMO_RECORDS_REPLY, runDemoResponder } from '../../lib/demo-live/responder';
import { planWantsSilence } from '../../lib/demo-live/silent';
import { InMemoryOnceStore } from '../../lib/workflows/once';
import type { DemoMail, DemoMessage } from '../../scripts/demo/mail';
import { looksLikeInjection } from '../../lib/inbox/classifier';

const COORD = 'coord@agentmail.to';
const OURS = 'aid-case-1@agentmail.to';
const env = { WAYFINDER_DEMO_COORDINATORS: '1', OUTBOUND_ALLOWLIST: COORD, DEMO_COORDINATOR_INBOXES: COORD, AGENTMAIL_API_KEY: 'k' };
const NOW = new Date('2026-10-24T12:00:00.000Z');

function mail(received: DemoMessage[]): DemoMail & { reply: ReturnType<typeof vi.fn> } {
  return {
    mode: 'agentmail',
    createInbox: vi.fn(),
    deleteInbox: vi.fn(),
    listInboxes: async () => [
      { inboxId: 'i-coord', address: COORD, displayName: 'Coordinator' },
      { inboxId: 'i-ours', address: OURS, displayName: 'Case inbox' },
    ],
    listReceived: async (id: string) => (id === COORD ? received : []),
    reply: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 2));
      return { messageId: 'r1' };
    }),
  };
}

const msg = (over: Partial<DemoMessage>): DemoMessage => ({
  messageId: 'm1', threadId: 't1', inboxId: 'i-coord', from: `Wayfinder <${OURS}>`, to: [COORD], subject: 'Patient intake inquiry', text: 'hi',
  receivedAt: new Date(NOW.getTime() - 60_000).toISOString(), ...over,
});

describe('server-side demo coordinator', () => {
  it('answers our own case inbox once per thread, even with overlapping runs', async () => {
    const m = mail([msg({}), msg({ messageId: 'm2', threadId: 't1' }), msg({ messageId: 'm3', threadId: 't2' })]);
    const once = new InMemoryOnceStore();
    const runs = await Promise.all([1, 2, 3].map(() => runDemoResponder({ env, mail: m, isOurThread: async (t) => t !== 'foreign', once, now: NOW })));
    expect(runs.reduce((n, r) => n + r.replied, 0)).toBe(2);
    expect(m.reply).toHaveBeenCalledTimes(2);
    expect(m.reply).toHaveBeenCalledWith(COORD, 'm1', DEMO_RECORDS_REPLY);
    expect(m.reply).toHaveBeenCalledWith(COORD, 'm3', DEMO_RECORDS_REPLY);
  });

  it('never replies outside a thread Wayfinder started, nor to a coordinator', async () => {
    const m = mail([msg({ threadId: 'foreign', from: 'someone@hospital.org' }), msg({ messageId: 'm2', threadId: 't2', from: COORD })]);
    const r = await runDemoResponder({ env, mail: m, isOurThread: async (t) => t !== 'foreign', once: new InMemoryOnceStore(), now: NOW });
    expect(r.replied).toBe(0);
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('recognises our mail by its RFC Message-ID when the coordinator inbox gives it its own thread id', async () => {
    const m = mail([msg({ messageId: '<sent-1@ses>', threadId: 'coord-side-thread' })]);
    const ourMessageIds = new Set(['<sent-1@ses>']);
    const seen: Array<[string, string]> = [];
    const r = await runDemoResponder({
      env, mail: m, once: new InMemoryOnceStore(), now: NOW,
      isOurThread: async (t, id) => ourMessageIds.has(id) || t === 'our-thread',
      isSilentThread: async (t, id) => { seen.push([t, id]); return false; },
    });
    expect(r.replied).toBe(1);
    expect(seen).toEqual([['coord-side-thread', '<sent-1@ses>']]);
  });

  it('is off outside demo mode or without an AgentMail key', async () => {
    const m = mail([msg({})]);
    expect(await runDemoResponder({ isOurThread: async () => true, env: { ...env, WAYFINDER_DEMO_COORDINATORS: '0' }, mail: m, once: new InMemoryOnceStore(), now: NOW })).toMatchObject({ enabled: false, replied: 0 });
    expect(await runDemoResponder({ isOurThread: async () => true, env: { ...env, AGENTMAIL_API_KEY: '' }, mail: m, once: new InMemoryOnceStore(), now: NOW })).toMatchObject({ enabled: false });
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('waits for the reading delay, skips old mail and silent threads, and releases the claim after a failed reply', async () => {
    const fresh = msg({ receivedAt: new Date(NOW.getTime() - 1_000).toISOString() });
    const old = msg({ messageId: 'm9', threadId: 't9', receivedAt: '2026-10-01T00:00:00.000Z' });
    const silent = msg({ messageId: 'm5', threadId: 't5' });
    const m = mail([fresh, old, silent]);
    const once = new InMemoryOnceStore();
    const r1 = await runDemoResponder({ env, mail: m, isOurThread: async (t) => t !== 'foreign', once, now: NOW, isSilentThread: async (t) => t === 't5' });
    expect(r1.replied).toBe(0);
    m.reply.mockRejectedValueOnce(new Error('provider down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const later = new Date(NOW.getTime() + 60_000);
    expect(await runDemoResponder({ env, mail: m, isOurThread: async (t) => t !== 'foreign', once, now: later, isSilentThread: async (t) => t === 't5' })).toMatchObject({ replied: 0, failed: 1 });
    expect(await runDemoResponder({ env, mail: m, isOurThread: async (t) => t !== 'foreign', once, now: later, isSilentThread: async (t) => t === 't5' })).toMatchObject({ replied: 1 });
    vi.restoreAllMocks();
  });

  it('the scripted reply is a plain records request the inbox agent accepts (no injection / exfil flags)', () => {
    expect(looksLikeInjection(DEMO_RECORDS_REPLY)).toBe(false);
    expect(DEMO_RECORDS_REPLY).toMatch(/medical records/);
  });
});

describe('planWantsSilence', () => {
  const step = (o: number, channel: 'email' | 'voice', waitFor = 'none') => ({ id: `s${o}`, order: o, channel, purpose: 'intro', targetRef: 'x', reason: 'r', evidenceIds: ['e'], waitFor, enabled: true });
  const plan = (steps: ReturnType<typeof step>[]) => ({ resources: [{ resourceKey: 'institution:a', contactId: 'c1', steps }] }) as never;
  it('is silent only for email followed by a waiting call', () => {
    expect(planWantsSilence(plan([step(1, 'email'), step(2, 'voice', 'business_days:3')]), 'c1', 'institution:a')).toBe(true);
    expect(planWantsSilence(plan([step(1, 'email')]), 'c1', 'institution:a')).toBe(false);
    expect(planWantsSilence(plan([step(1, 'voice')]), 'c1', 'institution:a')).toBe(false);
    expect(planWantsSilence(null, 'c1', 'institution:a')).toBe(false);
  });
});
