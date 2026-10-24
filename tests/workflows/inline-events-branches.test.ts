import { describe, expect, it, vi } from 'vitest';
import { initialContext, type ContactContext } from '../../lib/workflows/connection-machine';
import type { ConnectionDeps } from '../../lib/workflows/connection-workflow';
import { CONTACT_APPROVED, CONTACT_REPLY, FOLLOW_UP_APPROVED } from '../../lib/workflows/engine';
import type { WorkflowEvent } from '../../lib/workflows/events';
import { contactReplyEvent, followUpApprovedEvent } from '../../lib/workflows/events';
import { inlineSendEvents, schedulingConnected, workflowSendEvents } from '../../lib/workflows/inline-events';
import { OutreachError } from '../../lib/outreach/types';

const NOW = new Date('2026-10-29T13:00:00.000Z');
const FIRST = new Date('2026-10-26T12:00:00.000Z');

function deps(start: Partial<ContactContext> = {}, overrides: Partial<ConnectionDeps> = {}) {
  let ctx: ContactContext = { ...initialContext(), ...start };
  const saved: ContactContext[] = [];
  const d: ConnectionDeps = {
    clock: { now: () => NOW, scale: 1 },
    async send() {
      return { providerRef: 'pm-1' };
    },
    async loadMessageApproval() {
      return NOW.toISOString();
    },
    async loadContext() {
      return ctx;
    },
    async saveContext(_id, next) {
      ctx = next;
      saved.push(next);
    },
    async draftFollowUp() {
      throw new Error('inline mode never drafts follow-ups');
    },
    ...overrides,
  };
  return { d, saved, ctx: () => ctx };
}

const followUpEvent = () =>
  followUpApprovedEvent({ contactId: 'c', caseId: 'k', messageId: 'm', approvedAt: NOW.toISOString() });
const replyEvent = () =>
  contactReplyEvent({ contactId: 'c', caseId: 'k', dedupeKey: 'pm-1', receivedAt: NOW.toISOString() });

describe('schedulingConnected edge cases', () => {
  it('treats whitespace-only values as unset', () => {
    expect(schedulingConnected({ INNGEST_DEV: '   ' })).toBe(false);
    expect(schedulingConnected({ INNGEST_EVENT_KEY: ' ', INNGEST_SIGNING_KEY: ' ' })).toBe(false);
  });

  it('requires the signing key as well as the event key', () => {
    expect(schedulingConnected({ INNGEST_SIGNING_KEY: 's' })).toBe(false);
  });

  it('reads process.env by default', () => {
    expect(typeof schedulingConnected()).toBe('boolean');
  });
});

describe('inline follow-up refusals', () => {
  it('maps a DuplicateSendError to a 409 already_approved', async () => {
    const dup = Object.assign(new Error('duplicate'), { name: 'DuplicateSendError' });
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { send: async () => { throw dup; } });
    const err = await inlineSendEvents(() => d)(followUpEvent()).catch((e) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect(err.status).toBe(409);
    expect(err.reasons).toEqual(['already_approved']);
  });

  it('stringifies non-string refusal reasons', async () => {
    const refused = Object.assign(new Error('x'), { name: 'FollowUpRefusedError', reasons: [42, 'b'] });
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { send: async () => { throw refused; } });
    const err = await inlineSendEvents(() => d)(followUpEvent()).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.reasons).toEqual(['42', 'b']);
  });

  it('rethrows a FollowUpRefusedError whose reasons is not an array', async () => {
    const odd = Object.assign(new Error('odd'), { name: 'FollowUpRefusedError', reasons: 'nope' });
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { send: async () => { throw odd; } });
    await expect(inlineSendEvents(() => d)(followUpEvent())).rejects.toBe(odd);
  });

  it('rethrows an unrecognised Error unchanged', async () => {
    const boom = new Error('provider down');
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, { send: async () => { throw boom; } });
    await expect(inlineSendEvents(() => d)(followUpEvent())).rejects.toBe(boom);
  });

  it('rethrows a thrown non-object value unchanged', async () => {
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, {
      send: async () => { throw 'plain string'; },
    });
    await expect(inlineSendEvents(() => d)(followUpEvent())).rejects.toBe('plain string');
  });

  it('rethrows a thrown null unchanged', async () => {
    const { d } = deps({ state: 'sent', firstSentAt: FIRST, followUpsDue: 1 }, {
      send: async () => { throw null; },
    });
    await expect(inlineSendEvents(() => d)(followUpEvent())).rejects.toBeNull();
  });
});

describe('inline reply handling', () => {
  it('throws when the reply event has no contactId', async () => {
    const { d } = deps();
    const event = { name: CONTACT_REPLY, data: { caseId: 'k' } } as unknown as WorkflowEvent;
    await expect(inlineSendEvents(() => d)(event)).rejects.toThrow(/missing contactId/);
  });

  it('throws when the reply event has an empty contactId', async () => {
    const { d } = deps();
    const event = { name: CONTACT_REPLY, data: { contactId: '', caseId: 'k' } } as unknown as WorkflowEvent;
    await expect(inlineSendEvents(() => d)(event)).rejects.toThrow(/missing contactId/);
  });

  it('does not save or cancel anything for a drafted contact', async () => {
    const cancelPreapproved = vi.fn(async () => undefined);
    const { d, saved } = deps({ state: 'drafted' }, { cancelPreapproved });
    await inlineSendEvents(() => d)(replyEvent());
    expect(saved).toEqual([]);
    expect(cancelPreapproved).not.toHaveBeenCalled();
  });

  it('tolerates a missing cancelPreapproved hook', async () => {
    const { d, ctx } = deps({ state: 'sent', firstSentAt: FIRST });
    await inlineSendEvents(() => d)(replyEvent());
    expect(ctx().state).toBe('replied');
  });
});

describe('inlineSendEvents dispatch', () => {
  it('ignores unknown event names and a single non-array event', async () => {
    const { d, saved } = deps({ state: 'sent', firstSentAt: FIRST });
    const unknown = { name: 'something/else', data: {} } as unknown as WorkflowEvent;
    await inlineSendEvents(() => d)(unknown);
    expect(saved).toEqual([]);
  });

  it('skips contact/approved events inside a batch', async () => {
    const { d, saved } = deps({ state: 'sent', firstSentAt: FIRST });
    const approved = { name: CONTACT_APPROVED, data: { contactId: 'c' } } as unknown as WorkflowEvent;
    await inlineSendEvents(() => d)([approved]);
    expect(saved).toEqual([]);
  });

  it('handles an empty batch', async () => {
    const { d } = deps();
    await expect(inlineSendEvents(() => d)([])).resolves.toBeUndefined();
  });

  it('routes follow-up approvals to the gated sender (event name constant)', async () => {
    expect(followUpEvent().name).toBe(FOLLOW_UP_APPROVED);
  });
});

describe('workflowSendEvents', () => {
  it('uses the Inngest sender when scheduling is connected', () => {
    const send = workflowSendEvents({ INNGEST_DEV: '1' }, () => deps().d);
    expect(typeof send).toBe('function');
  });

  it('routes events through the injected deps when scheduling is not connected', async () => {
    const { d, ctx } = deps({ state: 'sent', firstSentAt: FIRST });
    await workflowSendEvents({}, () => d)(replyEvent());
    expect(ctx().state).toBe('replied');
  });
});
