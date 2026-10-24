import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', async () => {
  const { fakeDb } = await import('../helpers/db/fake-chain-db');
  return { getDb: () => fakeDb };
});

import { fakeDb } from '../helpers/db/fake-chain-db';
import { initialContext, type ContactContext } from '../../lib/workflows/connection-machine';
import {
  deriveContext, FOLLOW_UP_BODY, FOLLOW_UP_SUBJECT, followUpContent, InMemoryContactContextStore, PostgresContactContextStore,
  type ContactRowLike,
} from '../../lib/workflows/contact-store';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';

const d = (iso: string) => new Date(iso);
const row = (over: Partial<ContactRowLike> = {}): ContactRowLike => ({
  state: 'sent', firstSentAt: null, followUpsSent: 0, nextFollowUpAt: null, lastActivityAt: null, ...over,
});

describe('deriveContext', () => {
  it('has no outbound times and no first-sent anchor when nothing was sent', () => {
    const ctx = deriveContext(row(), [{ sentAt: null, classification: null }]);
    expect(ctx.lastOutboundAt).toBeNull();
    expect(ctx.firstSentAt).toBeNull();
    expect(ctx.followUpsDue).toBe(0);
  });
  it('uses the latest send as lastOutboundAt and backfills firstSentAt from the earliest send', () => {
    const ctx = deriveContext(row(), [
      { sentAt: d('2026-10-22T10:00:00Z'), classification: 'follow_up_1' },
      { sentAt: d('2026-10-20T10:00:00Z'), classification: null },
    ]);
    expect(ctx.firstSentAt).toEqual(d('2026-10-20T10:00:00Z'));
    expect(ctx.lastOutboundAt).toEqual(d('2026-10-22T10:00:00Z'));
    expect(ctx.followUpsDue).toBe(1);
  });
  it('does not backfill firstSentAt for a drafted contact', () => {
    expect(deriveContext(row({ state: 'drafted' }), [{ sentAt: d('2026-10-20T10:00:00Z'), classification: null }]).firstSentAt).toBeNull();
  });
  it('keeps the stored firstSentAt over the derived one', () => {
    const stored = d('2026-10-01T10:00:00Z');
    expect(deriveContext(row({ firstSentAt: stored }), [{ sentAt: d('2026-10-20T10:00:00Z'), classification: null }]).firstSentAt).toBe(stored);
  });
  it('counts a draft follow-up with no send as due', () => {
    expect(deriveContext(row(), [{ sentAt: null, classification: 'follow_up_1' }, { sentAt: null, classification: 'follow_up_2' }]).followUpsDue).toBe(2);
  });
});

describe('followUpContent', () => {
  it('email follow-ups carry the subject and a disclosure around the shared body', () => {
    const c = followUpContent('email');
    expect(c.subject).toBe(FOLLOW_UP_SUBJECT);
    expect(c.body).toContain(FOLLOW_UP_BODY);
  });
  it('voice follow-ups have no subject and lead with the AI disclosure', () => {
    const c = followUpContent('voice');
    expect(c.subject).toBeUndefined();
    expect(c.body.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
  });
  it('never includes case details in the canonical body', () => {
    expect(FOLLOW_UP_BODY).not.toMatch(/diagnos|disease|insurer|@/i);
  });
});

describe('PostgresContactContextStore', () => {
  beforeEach(() => fakeDb.reset());
  const store = new PostgresContactContextStore();
  const contactRow = { id: 'c1', state: 'sent', channel: 'email', firstSentAt: null, followUpsSent: 0, nextFollowUpAt: null, lastActivityAt: null };

  it('load throws for an unknown contact', async () => {
    fakeDb.enqueue([]);
    await expect(store.load('ghost')).rejects.toThrow('Contact ghost not found');
  });
  it('load derives the context from the contact row and outbound messages', async () => {
    fakeDb.enqueue([contactRow], [{ sentAt: d('2026-10-20T10:00:00Z'), classification: null }]);
    expect(await store.load('c1')).toMatchObject({ state: 'sent', firstSentAt: d('2026-10-20T10:00:00Z') });
  });
  it('save persists the machine context onto the contact row', async () => {
    fakeDb.enqueue([]);
    await store.save('c1', { ...initialContext(), state: 'sent', followUpsSent: 1 });
    const set = fakeDb.opsOf('update')[0].calls.find((c) => c.method === 'set')?.args[0];
    expect(set).toMatchObject({ state: 'sent', followUpsSent: 1 });
  });

  describe('createFollowUpDraft', () => {
    const args = { contactId: 'c1', caseId: 'case1', followUpNumber: 1 as const };
    it('throws when the contact is missing', async () => {
      fakeDb.enqueue([]);
      await expect(store.createFollowUpDraft(args)).rejects.toThrow('Contact c1 not found');
    });
    it('returns the existing draft instead of creating a duplicate', async () => {
      fakeDb.enqueue([contactRow], [{ id: 'm-existing', classification: 'follow_up_1' }]);
      expect(await store.createFollowUpDraft(args)).toEqual({ messageId: 'm-existing' });
      expect(fakeDb.opsOf('insert')).toHaveLength(0);
    });
    it('creates an unapproved draft threaded to the initial message and carrying the consented fields', async () => {
      fakeDb.enqueue([contactRow], [{ id: 'm0', classification: null, providerThreadId: 'thread-1' }], [{ sharedFields: ['diseaseName'] }], [{ id: 'm-new' }]);
      expect(await store.createFollowUpDraft(args)).toEqual({ messageId: 'm-new' });
      const values = fakeDb.opsOf('insert')[0].calls.find((c) => c.method === 'values')?.args[0];
      expect(values).toMatchObject({ providerThreadId: 'thread-1', sharedFields: ['diseaseName'], approvedAt: null, sentAt: null, classification: 'follow_up_1' });
    });
    it('falls back to no thread and no shared fields for a voice contact with no consent row', async () => {
      fakeDb.enqueue([{ ...contactRow, channel: 'voice' }], [], [], [{ id: 'm-new' }]);
      await store.createFollowUpDraft({ ...args, followUpNumber: 2 });
      const values = fakeDb.opsOf('insert')[0].calls.find((c) => c.method === 'values')?.args[0];
      expect(values).toMatchObject({ providerThreadId: null, sharedFields: [], subject: null, classification: 'follow_up_2', channel: 'voice' });
    });
    it('falls back to a null thread when the initial message has no provider thread', async () => {
      fakeDb.enqueue([contactRow], [{ id: 'm0', classification: null, providerThreadId: null }], [], [{ id: 'm-new' }]);
      await store.createFollowUpDraft(args);
      expect(fakeDb.opsOf('insert')[0].calls.find((c) => c.method === 'values')?.args[0]).toMatchObject({ providerThreadId: null });
    });
  });

  describe('loadMessageApproval', () => {
    it('is null when the message is missing or unapproved', async () => {
      fakeDb.enqueue([], [{ approvedAt: null }]);
      expect(await store.loadMessageApproval('m1')).toBeNull();
      expect(await store.loadMessageApproval('m1')).toBeNull();
    });
    it('returns the ISO approval time', async () => {
      fakeDb.enqueue([{ approvedAt: d('2026-10-21T10:00:00Z') }]);
      expect(await store.loadMessageApproval('m1')).toBe('2026-10-21T10:00:00.000Z');
    });
  });

  describe('loadThread', () => {
    it('is null when no outbound message has a provider id', async () => {
      fakeDb.enqueue([{ providerMessageId: null }, { providerMessageId: null }]);
      expect(await store.loadThread('c1')).toBeNull();
    });
    it('returns the most recent provider message with its thread when present', async () => {
      fakeDb.enqueue([{ providerMessageId: 'pm1', providerThreadId: 't1' }, { providerMessageId: 'pm2', providerThreadId: 't2' }]);
      expect(await store.loadThread('c1')).toEqual({ messageId: 'pm2', threadId: 't2' });
    });
    it('omits threadId when the provider gave none', async () => {
      fakeDb.enqueue([{ providerMessageId: 'pm1', providerThreadId: null }]);
      expect(await store.loadThread('c1')).toEqual({ messageId: 'pm1' });
    });
  });
});

describe('InMemoryContactContextStore', () => {
  it('loads a fresh initial context for unknown contacts and stores clones', async () => {
    const store = new InMemoryContactContextStore();
    expect(await store.load('c1')).toEqual(initialContext());
    const ctx: ContactContext = { ...initialContext(), state: 'sent' };
    await store.save('c1', ctx);
    ctx.state = 'declined';
    expect((await store.load('c1')).state).toBe('sent');
  });
  it('createFollowUpDraft is idempotent per contact and number, and raises followUpsDue', async () => {
    const store = new InMemoryContactContextStore();
    await store.save('c1', initialContext());
    const a = await store.createFollowUpDraft({ contactId: 'c1', caseId: 'x', followUpNumber: 2 });
    const b = await store.createFollowUpDraft({ contactId: 'c1', caseId: 'x', followUpNumber: 2 });
    expect(b).toEqual(a);
    expect(store.contexts.get('c1')?.followUpsDue).toBe(2);
    const other = await store.createFollowUpDraft({ contactId: 'c2', caseId: 'x', followUpNumber: 1 });
    expect(other.messageId).not.toBe(a.messageId);
    expect(store.contexts.has('c2')).toBe(false);
  });
  it('approvals and threads default to null', async () => {
    const store = new InMemoryContactContextStore();
    expect(await store.loadMessageApproval('m')).toBeNull();
    expect(await store.loadThread('c')).toBeNull();
    store.approvals.set('m', 'x'); store.threads.set('c', { messageId: 'pm' });
    expect(await store.loadMessageApproval('m')).toBe('x');
    expect(await store.loadThread('c')).toEqual({ messageId: 'pm' });
  });
});
