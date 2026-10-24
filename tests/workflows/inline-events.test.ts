import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialContext, type ContactContext } from '../../lib/workflows/connection-machine';
import type { ConnectionDeps } from '../../lib/workflows/connection-workflow';
import { contactApprovedEvent, contactReplyEvent, followUpApprovedEvent } from '../../lib/workflows/events';
import { followUpScheduler } from '../../lib/workflows/scheduler';
import { inlineSendEvents, schedulingConnected, workflowSendEvents } from '../../lib/workflows/inline-events';
import { OutreachError } from '../../lib/outreach/types';

const NOW = new Date('2026-10-29T13:00:00.000Z');
const FIRST = new Date('2026-10-26T12:00:00.000Z');

function deps(start: Partial<ContactContext> = {}, overrides: Partial<ConnectionDeps> = {}) {
  let ctx: ContactContext = { ...initialContext(), ...start };
  const sent: unknown[] = [];
  const cancelled: unknown[] = [];
  const d: ConnectionDeps = {
    clock: { now: () => NOW, scale: 1 },
    async send(input) { sent.push(input); return { providerRef: 'pm-1' }; },
    async loadMessageApproval() { return NOW.toISOString(); },
    async loadContext() { return ctx; },
    async saveContext(_id, next) { ctx = next; },
    async draftFollowUp() { throw new Error('inline mode never drafts follow-ups'); },
    async cancelPreapproved(input) { cancelled.push(input); },
    ...overrides,
  };
  return { d, sent, cancelled, ctx: () => ctx };
}

describe('schedulingConnected', () => {
  it('needs both Inngest keys, or the dev server', () => {
    expect(schedulingConnected({})).toBe(false);
    expect(schedulingConnected({ INNGEST_EVENT_KEY: 'k' })).toBe(false);
    expect(schedulingConnected({ INNGEST_EVENT_KEY: 'k', INNGEST_SIGNING_KEY: 's' })).toBe(true);
    expect(schedulingConnected({ INNGEST_DEV: '1' })).toBe(true);
    expect(schedulingConnected({ INNGEST_DEV: '0' })).toBe(false);
  });
});

describe('workflowSendEvents without Inngest', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not throw for contact/approved (the first message was already sent through the gate)', async () => {
    const { d, sent } = deps({ state: 'sent', firstSentAt: FIRST });
    const send = workflowSendEvents({}, () => d);
    await expect(send(contactApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() }))).resolves.toBeUndefined();
    expect(sent).toEqual([]); // timers are not scheduled and nothing extra is sent
  });

  it('accepts a webhook reply event with the default deps instead of throwing', async () => {
    const send = workflowSendEvents({ DATABASE_URL: '' });
    await expect(send(contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-9', receivedAt: NOW.toISOString() }))).resolves.toBeUndefined();
  });
});

describe('followUpScheduler', () => {
  it('prefers Inngest, then cron (CRON_SECRET), else none', () => {
    expect(followUpScheduler({})).toBe('none');
    expect(followUpScheduler({ CRON_SECRET: '  ' })).toBe('none');
    expect(followUpScheduler({ CRON_SECRET: 'x' })).toBe('cron');
    expect(followUpScheduler({ CRON_SECRET: 'x', INNGEST_EVENT_KEY: 'k', INNGEST_SIGNING_KEY: 's' })).toBe('inngest');
  });
});

describe('contact/approved without Inngest', () => {
  const approved = () => contactApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() });

  it('schedules next_follow_up_at at business day 3 instead of pausing', async () => {
    const { d, sent, ctx } = deps({ state: 'sent', firstSentAt: FIRST });
    await inlineSendEvents(() => d)(approved());
    expect(ctx().nextFollowUpAt?.toISOString()).toBe('2026-10-29T12:00:00.000Z');
    expect(sent).toEqual([]);
  });

  it('keeps an existing schedule, and ignores contacts that are not waiting', async () => {
    const existing = new Date('2026-11-04T12:00:00.000Z');
    const a = deps({ state: 'sent', firstSentAt: FIRST, nextFollowUpAt: existing });
    await inlineSendEvents(() => a.d)(approved());
    expect(a.ctx().nextFollowUpAt).toEqual(existing);
    const b = deps({ state: 'replied', firstSentAt: FIRST });
    await inlineSendEvents(() => b.d)(approved());
    expect(b.ctx().nextFollowUpAt).toBeNull();
  });
});

describe('inlineSendEvents', () => {
  it('sends an approved follow-up synchronously, once, through deps.send', async () => {
    const { d, sent, ctx } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1, followUpsSent: 0 });
    await inlineSendEvents(() => d)(followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() }));
    expect(sent).toEqual([{ contactId: 'c', caseId: 'k', messageId: 'm', kind: 'follow_up' }]);
    expect(ctx().followUpsSent).toBe(1);
  });

  it('never sends a follow-up the database does not show as approved', async () => {
    const { d, sent } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { loadMessageApproval: async () => null });
    await inlineSendEvents(() => d)(followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() }));
    expect(sent).toEqual([]);
  });

  it('turns a gate refusal into a 422 with its reasons', async () => {
    const refused = Object.assign(new Error('follow-up refused: not_allowlisted'), { name: 'FollowUpRefusedError', reasons: ['not_allowlisted'] });
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { send: async () => { throw refused; } });
    const err = await inlineSendEvents(() => d)(followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() })).catch(e => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect(err.status).toBe(422);
    expect(err.reasons).toEqual(['not_allowlisted']);
  });

  it('marks a sent contact replied when a reply arrives and cancels pre-approved follow-ups', async () => {
    const { d, cancelled, ctx } = deps({ state: 'sent', firstSentAt: FIRST });
    await inlineSendEvents(() => d)(contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-2', receivedAt: NOW.toISOString() }));
    expect(ctx().state).toBe('replied');
    expect(cancelled).toEqual([{ contactId: 'c', reason: 'reply' }]);
  });

  it('revives a stalled contact on reply', async () => {
    const { d, ctx } = deps({ state: 'stalled', firstSentAt: FIRST });
    await inlineSendEvents(() => d)(contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-3', receivedAt: NOW.toISOString() }));
    expect(ctx().state).toBe('replied');
  });

  it('leaves other states alone on reply', async () => {
    const { d, ctx } = deps({ state: 'task_open', firstSentAt: FIRST });
    await inlineSendEvents(() => d)(contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-4', receivedAt: NOW.toISOString() }));
    expect(ctx().state).toBe('task_open');
  });

  it('handles a batch of events', async () => {
    const { d, ctx } = deps({ state: 'sent', firstSentAt: FIRST });
    await inlineSendEvents(() => d)([
      contactApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() }),
      contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-5', receivedAt: NOW.toISOString() }),
    ]);
    expect(ctx().state).toBe('replied');
  });
});
