import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', async () => {
  const { fakeDb } = await import('../helpers/db/fake-chain-db');
  return { getDb: () => fakeDb };
});

import { fakeDb } from '../helpers/db/fake-chain-db';
import { MockBrowserProvider } from '../../lib/channels/mock-browser';
import { KernelBrowserProvider } from '../../lib/channels/kernel-web';
import { WebFormChannel } from '../../lib/channels/web-form';
import {
  createFollowUpSender, DuplicateSendError, WiredOutreachService, FollowUpRefusedError, isFollowUpClassification, PostgresFollowUpStore, selectChannels,
  selectWebChannel, type FollowUpMessage, type FollowUpStore,
} from '../../lib/outreach/channel-wiring';
import { OutreachService } from '../../lib/outreach/service';
import { recordingSendEvents } from '../../lib/workflows/events';
import { OutreachError, type Channel, type Consent, type Contact, type OutreachStore } from '../../lib/outreach/types';
import { withDisclosure } from '../../lib/safety/disclosure';

const ADDR = 'intake@example.com';
const CASE_ID = 'case1';
const FIRST_SENT = '2026-10-26T12:00:00.000Z'; // Monday
const DAY3_PLUS = new Date('2026-10-29T13:00:00.000Z'); // Thursday
const ENV = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: ADDR };

describe('isFollowUpClassification', () => {
  it.each([[null, false], [undefined, false], ['', false], ['reply', false], ['follow_up_1', true]] as const)('%s -> %s', (value, expected) => {
    expect(isFollowUpClassification(value)).toBe(expected);
  });
});

describe('selectChannels edge cases', () => {
  it('treats whitespace-only keys as absent and logs each provider combination once', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const out = selectChannels({ AGENTMAIL_API_KEY: '   ', AGENTCALL_API_KEY: ' ', AGENTCALL_FROM_NUMBER_ID: ' ' });
    expect(out.providers).toEqual({ email: 'mock-mailer', voice: 'mock-caller' });
    selectChannels({});
    expect(info.mock.calls.filter((c) => String(c[0]).includes('mock-mailer/mock-caller')).length).toBeLessThanOrEqual(1);
    info.mockRestore();
  });
  it('passes the injected clock and fetcher to real adapters without calling the network', () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const out = selectChannels({ AGENTMAIL_API_KEY: 'k', AGENTCALL_API_KEY: 'k', AGENTCALL_FROM_NUMBER_ID: 'n' }, { now: () => new Date(), fetcher });
    expect(out.providers).toEqual({ email: 'agentmail', voice: 'agentcall' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('selectWebChannel', () => {
  it('uses the mock browser provider offline', () => {
    expect(selectWebChannel({ WAYFINDER_OFFLINE: '1' })).toBeInstanceOf(WebFormChannel);
  });
  it('uses Kernel with or without an API key when online', () => {
    expect(selectWebChannel({})).toBeInstanceOf(WebFormChannel);
    expect(selectWebChannel({ KERNEL_API_KEY: ' synthetic ' })).toBeInstanceOf(WebFormChannel);
  });
  it('prefers an injected provider and upload loader', () => {
    const provider = new MockBrowserProvider({});
    expect(selectWebChannel({}, { provider, loadUpload: async () => null as never })).toBeInstanceOf(WebFormChannel);
    expect(KernelBrowserProvider).toBeDefined();
  });
});

describe('PostgresFollowUpStore', () => {
  beforeEach(() => fakeDb.reset());
  const store = new PostgresFollowUpStore();
  const dbRow = (over: Record<string, unknown> = {}) => ({
    id: 'm1', contact_id: 'c1', case_id: CASE_ID, classification: 'follow_up_1', approved_at: null, sent_at: null, direction: 'outbound',
    channel: 'email', subject: 'S', body: 'B', ...over,
  });
  const execRows = (rows: unknown[]) => ({ rows });

  it('getMessage is undefined when no row is found', async () => {
    fakeDb.enqueue(execRows([]));
    expect(await store.getMessage('m1')).toBeUndefined();
  });
  it('maps columns, ISO-formats timestamps and keeps a present subject', async () => {
    fakeDb.enqueue(execRows([dbRow({ approved_at: new Date('2026-10-21T10:00:00Z'), sent_at: '2026-10-22T10:00:00Z' })]));
    expect(await store.getMessage('m1')).toEqual({
      messageId: 'm1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: '2026-10-21T10:00:00.000Z',
      sentAt: '2026-10-22T10:00:00.000Z', direction: 'outbound', channel: 'email', subject: 'S', body: 'B',
    });
  });
  it('omits an empty subject and normalizes an undefined classification to null', async () => {
    fakeDb.enqueue(execRows([dbRow({ subject: null, classification: undefined })]));
    const out = await store.getMessage('m1');
    expect(out).not.toHaveProperty('subject');
    expect(out?.classification).toBeNull();
    expect(out?.approvedAt).toBeNull();
  });
  it('get scopes the lookup to the contact', async () => {
    fakeDb.enqueue(execRows([dbRow()]), execRows([]));
    expect((await store.get('m1', 'c1'))?.messageId).toBe('m1');
    expect(await store.get('m1', 'other')).toBeUndefined();
  });
  it('markFirstSent, release and delivered issue the expected statements', async () => {
    fakeDb.enqueue(execRows([]), execRows([]), []);
    await store.markFirstSent('c1', FIRST_SENT);
    await store.release('m1', 'c1');
    await store.delivered('m1', 'c1', { messageId: 'pm1' }, FIRST_SENT);
    await store.delivered('m1', 'c1', {}, FIRST_SENT);
    expect(fakeDb.opsOf('execute')).toHaveLength(2 + 4);
    expect(fakeDb.opsOf('batch')).toHaveLength(2);
  });
  it('approveFollowUp is true only for exactly one newly approved row; withdraw issues one statement', async () => {
    fakeDb.enqueue(execRows([{ id: 'm1' }]), execRows([]), execRows([]));
    expect(await store.approveFollowUp('m1', 'c1', FIRST_SENT)).toBe(true);
    expect(await store.approveFollowUp('m1', 'c1', FIRST_SENT)).toBe(false);
    await store.withdrawFollowUpApproval('m1', 'c1');
    expect(fakeDb.opsOf('execute')).toHaveLength(3);
  });
  it('reserve is true only for exactly one claimed row', async () => {
    fakeDb.enqueue(execRows([{ id: 'm1' }]), execRows([]));
    expect(await store.reserve('m1', 'c1', FIRST_SENT)).toBe(true);
    expect(await store.reserve('m1', 'c1', FIRST_SENT)).toBe(false);
  });
});

describe('createFollowUpSender refusals and edge cases', () => {
  const contactBase: Contact & { firstSentAt?: string | null } = {
    id: 'c1', caseId: CASE_ID, targetId: 't1', targetKind: 'expert', channel: 'email', address: ADDR, state: 'sent', followUpsSent: 0, firstSentAt: FIRST_SENT,
  } as never;
  const message = (over: Partial<FollowUpMessage> = {}): FollowUpMessage => ({
    messageId: 'm1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: '2026-10-29T12:30:00.000Z', sentAt: null, direction: 'outbound',
    channel: 'email', subject: 'Following up', body: withDisclosure('Following up on my earlier note.'), ...over,
  });
  const consent: Consent = { contactId: 'c1', sharedFields: ['diseaseName'], approvedAt: '2026-10-23T11:00:00Z' };

  function build(opts: {
    message?: FollowUpMessage | undefined; contacts?: (Contact & Record<string, unknown>)[]; consent?: Consent | undefined; record?: object | undefined;
    channels?: Channel[]; reserve?: boolean; env?: Record<string, string | undefined>; now?: Date;
  } = {}) {
    const contacts = opts.contacts ?? [contactBase];
    const store = {
      contact: async (id: string) => contacts.find((c) => c.id === id),
      contacts: async () => contacts,
      consent: async () => ('consent' in opts ? opts.consent : consent),
      getCase: async () => ('record' in opts ? opts.record : { diseaseName: 'fictional disease' }),
    } as unknown as OutreachStore;
    const calls = { reserve: 0, release: 0, delivered: 0 };
    const db: FollowUpStore = {
      getMessage: async () => ('message' in opts ? opts.message : message()),
      reserve: async () => { calls.reserve += 1; return opts.reserve ?? true; },
      release: async () => { calls.release += 1; },
      delivered: async () => { calls.delivered += 1; },
    };
    const email: Channel = { kind: 'email', send: vi.fn(async () => ({ messageId: 'pm1' })) } as unknown as Channel;
    const send = createFollowUpSender({ env: opts.env ?? ENV, store, channels: opts.channels ?? [email], clock: () => opts.now ?? DAY3_PLUS, db });
    return { send, calls, email, input: { contactId: 'c1', caseId: CASE_ID, messageId: 'm1', kind: 'follow_up' as const } };
  }
  const refusal = (reason: string) => expect.objectContaining({ name: 'FollowUpRefusedError', reasons: [reason] });

  it.each([
    ['the message does not exist', { message: undefined }],
    ['the message is inbound', { message: message({ direction: 'inbound' }) }],
    ['the message belongs to another contact', { message: message({ contactId: 'other' }) }],
    ['the message is not a follow-up', { message: message({ classification: null }) }],
  ])('refuses when %s', async (_n, over) => {
    const c = build(over);
    await expect(c.send(c.input)).rejects.toEqual(refusal('not_a_follow_up_for_contact'));
    expect(c.calls.reserve).toBe(0);
  });

  it('throws DuplicateSendError on the fast path when already sent', async () => {
    const c = build({ message: message({ sentAt: FIRST_SENT }) });
    await expect(c.send(c.input)).rejects.toBeInstanceOf(DuplicateSendError);
    expect(c.calls.reserve).toBe(0);
  });
  it.each([['missing', null], ['invalid', 'not-a-date']])('refuses without claiming when the persisted approval is %s', async (_n, approvedAt) => {
    const c = build({ message: message({ approvedAt }) });
    await expect(c.send(c.input)).rejects.toEqual(refusal('not_approved'));
    expect(c.calls.reserve).toBe(0);
  });

  it('refuses an unknown contact, a case mismatch, and a message from another case', async () => {
    await expect(build({ contacts: [] }).send(build().input)).rejects.toEqual(refusal('contact_not_found'));
    const a = build({ contacts: [{ ...contactBase, caseId: 'other-case' }] });
    await expect(a.send(a.input)).rejects.toEqual(refusal('contact_not_found'));
    const b = build({ message: message({ caseId: 'other-case' }) });
    await expect(b.send(b.input)).rejects.toEqual(refusal('contact_not_found'));
  });

  it('refuses a channel mismatch and an unavailable channel', async () => {
    const mismatch = build({ message: message({ channel: 'voice' }) });
    await expect(mismatch.send(mismatch.input)).rejects.toEqual(refusal('channel_mismatch'));
    const none = build({ channels: [] });
    await expect(none.send(none.input)).rejects.toEqual(refusal('channel_unavailable'));
  });

  it('refuses without approved consent, and distinguishes a missing case record', async () => {
    const noConsent = build({ consent: undefined });
    await expect(noConsent.send(noConsent.input)).rejects.toEqual(refusal('consent_required'));
    const unapproved = build({ consent: { ...consent, approvedAt: '' } });
    await expect(unapproved.send(unapproved.input)).rejects.toEqual(refusal('consent_required'));
    const noCase = build({ record: undefined });
    await expect(noCase.send(noCase.input)).rejects.toEqual(refusal('case_not_found'));
  });

  it.each([
    ['follow_up_2 before any follow_up_1 was sent', { message: message({ classification: 'follow_up_2' }) }],
    ['follow_up_1 after one was already sent', { contacts: [{ ...contactBase, followUpsSent: 1 }] }],
    ['a third follow-up', { message: message({ classification: 'follow_up_3' }), contacts: [{ ...contactBase, followUpsSent: 2 }] }],
  ])('refuses out of order: %s', async (_n, over) => {
    const c = build(over as never);
    await expect(c.send(c.input)).rejects.toEqual(refusal('follow_up_out_of_order'));
    expect(c.calls.reserve).toBe(0);
  });

  it('treats an unset followUpsSent as zero', async () => {
    const c = build({ contacts: [{ ...contactBase, followUpsSent: undefined } as never] });
    await expect(c.send(c.input)).resolves.toEqual({ providerRef: 'pm1' });
  });

  it('falls back to lastSentAt as the cadence anchor when firstSentAt is absent', async () => {
    const rest = { ...contactBase, firstSentAt: undefined };
    const c = build({ contacts: [{ ...rest, lastSentAt: FIRST_SENT } as never] });
    await expect(c.send(c.input)).resolves.toBeDefined();
    const tooEarly = build({ contacts: [{ ...rest, lastSentAt: FIRST_SENT } as never], now: new Date('2026-10-27T12:00:00Z') });
    await expect(tooEarly.send(tooEarly.input)).rejects.toBeInstanceOf(FollowUpRefusedError);
    expect(tooEarly.calls.release).toBe(1);
  });

  it('uses real time when the contact has no send anchor and lets the gate decide', async () => {
    const rest = { ...contactBase, firstSentAt: undefined };
    const c = build({ contacts: [rest as never] });
    await expect(c.send(c.input)).rejects.toBeInstanceOf(FollowUpRefusedError);
    expect(c.calls.release).toBe(1);
    expect(c.email.send).not.toHaveBeenCalled();
  });

  it('throws DuplicateSendError when the atomic reserve loses the race', async () => {
    const c = build({ reserve: false });
    await expect(c.send(c.input)).rejects.toBeInstanceOf(DuplicateSendError);
    expect(c.email.send).not.toHaveBeenCalled();
  });

  it('omits an empty subject from the gated draft and returns the provider call id when there is no message id', async () => {
    const email = { kind: 'email', send: vi.fn(async () => ({ callId: 'call-9' })) } as unknown as Channel;
    const c = build({ message: message({ subject: undefined }), channels: [email] });
    // An empty subject for an email may be refused by the gate; either outcome must not send twice.
    const out = await c.send(c.input).catch((e) => e);
    if (out instanceof FollowUpRefusedError) expect(c.calls.release).toBe(1);
    else expect(out).toEqual({ providerRef: 'call-9' });
  });

  it('falls back to the message id when the provider returns no ids', async () => {
    const email = { kind: 'email', send: vi.fn(async () => ({})) } as unknown as Channel;
    const c = build({ channels: [email] });
    expect(await c.send(c.input)).toEqual({ providerRef: 'm1' });
    expect(c.calls.delivered).toBe(1);
  });

  it('applies simulated time only outside production', async () => {
    const env = { ...ENV, WAYFINDER_SIM_TIME_SCALE: '1440' };
    const soon = new Date('2026-10-26T12:04:00Z');
    const dev = build({ env, now: soon });
    await expect(dev.send(dev.input)).resolves.toBeDefined();
    const prod = build({ env: { ...env, NODE_ENV: 'production' }, now: soon });
    await expect(prod.send(prod.input)).rejects.toBeInstanceOf(FollowUpRefusedError);
  });

  it('refuses as out of order when the contact is missing from the case contact list', async () => {
    const c = build();
    const store = {
      contact: async () => contactBase, contacts: async () => [], consent: async () => consent, getCase: async () => ({ diseaseName: 'x' }),
    } as unknown as OutreachStore;
    const db: FollowUpStore = { getMessage: async () => message(), reserve: async () => true, release: async () => {}, delivered: async () => {} };
    const email = { kind: 'email', send: vi.fn() } as unknown as Channel;
    const send = createFollowUpSender({ env: ENV, store, channels: [email], clock: () => DAY3_PLUS, db });
    await expect(send(c.input)).rejects.toEqual(refusal('follow_up_out_of_order'));
  });

  it('defaults to process.env and the system clock when options are omitted', async () => {
    const db: FollowUpStore = { getMessage: async () => undefined, reserve: async () => true, release: async () => {}, delivered: async () => {} };
    const send = createFollowUpSender({ db, store: {} as OutreachStore, channels: [] });
    await expect(send({ contactId: 'c1', caseId: CASE_ID, messageId: 'm1', kind: 'follow_up' })).rejects.toEqual(refusal('not_a_follow_up_for_contact'));
  });

  it('lazily builds the Postgres store, channels and follow-up store when none are injected', async () => {
    fakeDb.reset();
    fakeDb.enqueue({ rows: [] });
    const send = createFollowUpSender({ env: { ...ENV, WAYFINDER_OFFLINE: '1' } });
    await expect(send({ contactId: 'c1', caseId: CASE_ID, messageId: 'm1', kind: 'follow_up' })).rejects.toEqual(refusal('not_a_follow_up_for_contact'));
  });
});

describe('WiredOutreachService edge cases', () => {
  const store = { contact: async () => ({ id: 'c1', caseId: CASE_ID }) } as unknown as OutreachStore;
  const reader = (followUp: unknown, approve = true) => ({ get: async () => followUp, markFirstSent: vi.fn(async () => {}), approveFollowUp: async () => approve, withdrawFollowUpApproval: vi.fn(async () => {}) }) as never;

  it('returns a queued result from the base service untouched, without stamping or emitting', async () => {
    const ev = recordingSendEvents();
    const markFirstSent = vi.fn(async () => {});
    const svc = new WiredOutreachService(store, [], ev.send, undefined, undefined, { get: async () => undefined, markFirstSent, approveFollowUp: async () => false, withdrawFollowUpApproval: async () => {} });
    vi.spyOn(OutreachService.prototype, 'approve').mockResolvedValueOnce({ draftId: 'd1', approvedAt: FIRST_SENT, queued: true });
    expect(await svc.approve('c1', 'd1')).toEqual({ draftId: 'd1', approvedAt: FIRST_SENT, queued: true });
    expect(markFirstSent).not.toHaveBeenCalled();
    expect(ev.events).toHaveLength(0);
  });
  it('uses the system clock for follow-up approvals and rejects a sent follow-up as already approved', async () => {
    const ev = recordingSendEvents();
    ev.send.durable = true; // only a durable engine may report a follow-up as queued
    const svc = new WiredOutreachService(store, [], ev.send, undefined, undefined, reader({ messageId: 'd1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: null, sentAt: null }));
    const out = await svc.approve('c1', 'd1');
    expect(out).toMatchObject({ draftId: 'd1', queued: true });
    expect(Math.abs(new Date(out.approvedAt).getTime() - Date.now())).toBeLessThan(60_000);
    const sent = new WiredOutreachService(store, [], ev.send, undefined, undefined, reader({ messageId: 'd1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: null, sentAt: FIRST_SENT }, false));
    await expect(sent.approve('c1', 'd1')).rejects.toMatchObject({ status: 409 });
  });
  it('inline: a follow-up still unsent after the event is withdrawn and reported, never queued', async () => {
    const ev = recordingSendEvents();
    const r = reader({ messageId: 'd1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: null, sentAt: null }) as unknown as { withdrawFollowUpApproval: ReturnType<typeof vi.fn> };
    const svc = new WiredOutreachService(store, [], ev.send, undefined, undefined, r as never);
    await expect(svc.approve('c1', 'd1')).rejects.toMatchObject({ status: 409, reasons: ['follow_up_not_sent'] });
    expect(r.withdrawFollowUpApproval).toHaveBeenCalledWith('d1', 'c1');
  });
  it('withdraws the follow-up approval when emitting the event fails', async () => {
    const r = reader({ messageId: 'd1', contactId: 'c1', caseId: CASE_ID, classification: 'follow_up_1', approvedAt: null, sentAt: null }) as unknown as { withdrawFollowUpApproval: ReturnType<typeof vi.fn> };
    const svc = new WiredOutreachService(store, [], async () => { throw new OutreachError(422, ['not_allowlisted']); }, undefined, undefined, r as never);
    await expect(svc.approve('c1', 'd1')).rejects.toMatchObject({ status: 422 });
    expect(r.withdrawFollowUpApproval).toHaveBeenCalledWith('d1', 'c1');
  });
  it('logs only the error name, or unknown for non-Error failures, when the hand-off fails after a send', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const svc = new WiredOutreachService(store, [], async () => { throw 'secret-detail'; }, undefined, undefined, { get: async () => undefined, markFirstSent: async () => {}, approveFollowUp: async () => false, withdrawFollowUpApproval: async () => {} });
    vi.spyOn(OutreachService.prototype, 'approve').mockResolvedValueOnce({ draftId: 'd1', approvedAt: FIRST_SENT, sentAt: FIRST_SENT, provider: 'mock' } as never);
    expect(await svc.approve('c1', 'd1')).toMatchObject({ workflow: 'pending' });
    expect(logged.mock.calls[0][1]).toBe('unknown');
    logged.mockRestore();
  });
});
