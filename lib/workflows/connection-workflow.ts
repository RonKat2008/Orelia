/**
 * Per-contact connection workflow. Pure orchestration: this module NEVER
 * imports a channel or anything that sends. All outbound goes through the
 * injected `deps.send`, which the integrator wires to the OutboundGate.
 *
 * Inngest replays handlers, so every I/O and every clock read lives inside a
 * step.run with a stable unique id, and step results are JSON-safe (ISO strings,
 * never Dates).
 */
import type { Clock } from './clock';
import { scaleDeadline } from './clock';
import {
  CONTACT_APPROVED,
  CONTACT_REPLY,
  CONTACT_STALLED,
  FOLLOW_UP_APPROVED,
  FOLLOW_UP_DRAFTED,
  type FunctionDefinition,
} from './engine';
import {
  followUpDeadlines,
  transition,
  type ConnectionEvent,
  type ContactContext,
} from './connection-machine';

export interface ConnectionDeps {
  clock: Clock;
  tz?: string;
  /** INJECTED. Real impl runs OutboundGate + a channel adapter. */
  send(input: {
    contactId: string;
    caseId: string;
    messageId: string;
    kind: 'initial' | 'follow_up';
  }): Promise<{ providerRef: string }>;
  loadContext(contactId: string): Promise<ContactContext>;
  saveContext(contactId: string, ctx: ContactContext): Promise<void>;
  /** Creates an UNAPPROVED draft for the patient to review; never sends. */
  draftFollowUp(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
  }): Promise<{ messageId: string }>;
}

type Phase = 'followUp1' | 'followUp2' | 'stall';
const PHASES: Phase[] = ['followUp1', 'followUp2', 'stall'];

function matchContact(contactId: string): string {
  // JSON.stringify yields a safely escaped string literal for the CEL-like expression.
  return `async.data.contactId == ${JSON.stringify(contactId)}`;
}

async function applyTransition(
  deps: ConnectionDeps,
  contactId: string,
  event: ConnectionEvent,
  now: Date,
) {
  const ctx = await deps.loadContext(contactId);
  const res = transition(ctx, event, now, { tz: deps.tz });
  if (!res.ok) {
    throw new Error(
      `Invalid transition ${event.type} from ${res.from} for contact ${contactId}: ${res.error}`,
    );
  }
  await deps.saveContext(contactId, res.context);
  return res;
}

export function createConnectionWorkflow(deps: ConnectionDeps): FunctionDefinition {
  return {
    id: 'contact-connection',
    trigger: { event: CONTACT_APPROVED },
    idempotency: 'event.data.contactId',
    async handler({ event, step }) {
      const { contactId, caseId, messageId, approvedAt } = event.data ?? {};
      const ifExpr = matchContact(contactId);
      if (
        !approvedAt ||
        typeof approvedAt !== 'string' ||
        Number.isNaN(new Date(approvedAt).getTime())
      ) {
        throw new Error('contact/approved without valid approvedAt; refusing to proceed');
      }
      if (!contactId || !caseId || !messageId) {
        throw new Error('contact/approved missing contactId, caseId or messageId');
      }

      // 1. The approve route has normally already sent the initial message (state
      // 'sent'). Send only while 'drafted' (live wiring refuses that); if 'sent'
      // already, skip the send so it can never go out twice.
      const first = await step.run('send-initial', async () => {
        const ctx = await deps.loadContext(contactId);
        if (ctx.state === 'drafted') {
          await deps.send({ contactId, caseId, messageId, kind: 'initial' });
          await applyTransition(deps, contactId, { type: 'APPROVED_SENT' }, deps.clock.now());
        } else if (ctx.state !== 'sent') {
          return { state: ctx.state as string, firstSentAt: null as string | null };
        }
        const after = await deps.loadContext(contactId);
        return {
          state: after.state as string,
          firstSentAt: after.firstSentAt ? new Date(after.firstSentAt).toISOString() : null,
        };
      });
      if (first.state !== 'sent' || !first.firstSentAt) return { outcome: first.state };
      const firstSentAt = first.firstSentAt;

      // 3. Follow-up cadence: business day 3, 7, then stall at 10.
      for (const phase of PHASES) {
        const gate = await step.run(`check-state-${phase}`, async () => {
          const ctx = await deps.loadContext(contactId);
          return { state: ctx.state as string };
        });
        if (gate.state !== 'sent') return { outcome: gate.state };

        const deadline = await step.run(`deadline-${phase}`, async () => {
          const d = followUpDeadlines(new Date(firstSentAt), deps.tz);
          const real = d[phase];
          const scaled = scaleDeadline(new Date(firstSentAt), real, deps.clock.scale);
          return { real: real.toISOString(), scaled: scaled.toISOString() };
        });

        const reply = await step.waitForEvent(`wait-reply-${phase}`, {
          event: CONTACT_REPLY,
          timeout: new Date(deadline.scaled),
          if: ifExpr,
        });

        if (reply) {
          await step.run(`reply-${phase}`, async () => {
            await applyTransition(deps, contactId, { type: 'REPLY_RECEIVED' }, deps.clock.now());
            return { ok: true };
          });
          return { outcome: 'replied' };
        }

        // Timed out. When the clock is accelerated the real wall time is far
        // before the real business-day deadline, so the machine's "not due yet"
        // check would reject FOLLOW_UP_DUE. Use max(now, unscaled real deadline).
        const due = await step.run(`follow-up-due-${phase}`, async () => {
          const real = new Date(deadline.real);
          const now = deps.clock.now();
          const at = now.getTime() > real.getTime() ? now : real;
          const res = await applyTransition(deps, contactId, { type: 'FOLLOW_UP_DUE' }, at);
          return { effects: res.effects.map((e) => ({ ...e })) as { type: string; followUpNumber?: number }[] };
        });

        for (const effect of due.effects) {
          if (effect.type === 'DRAFT_FOLLOW_UP') {
            const followUpNumber = effect.followUpNumber as 1 | 2;
            // Draft only. Sending requires patient approval (FOLLOW_UP_APPROVED).
            const draft = await step.run(`draft-follow-up-${followUpNumber}`, () =>
              deps.draftFollowUp({ contactId, caseId, followUpNumber }),
            );
            await step.sendEvent(`emit-follow-up-drafted-${followUpNumber}`, {
              name: FOLLOW_UP_DRAFTED,
              data: { contactId, caseId, messageId: draft.messageId, followUpNumber },
            });
          } else if (effect.type === 'MARK_STALLED') {
            await step.sendEvent('emit-stalled', {
              name: CONTACT_STALLED,
              data: { contactId, caseId },
            });
            return { outcome: 'stalled' };
          }
        }
      }
      return { outcome: 'stalled' };
    },
  };
}

export function createFollowUpSendWorkflow(deps: ConnectionDeps): FunctionDefinition {
  return {
    id: 'contact-follow-up-send',
    trigger: { event: FOLLOW_UP_APPROVED },
    idempotency: 'event.data.messageId',
    async handler({ event, step }) {
      const { contactId, caseId, messageId, approvedAt } = event.data ?? {};
      if (
        !approvedAt ||
        typeof approvedAt !== 'string' ||
        Number.isNaN(new Date(approvedAt).getTime())
      ) {
        throw new Error('contact/follow-up.approved without valid approvedAt; refusing to send');
      }
      if (!contactId || !caseId || !messageId) {
        throw new Error('contact/follow-up.approved missing contactId, caseId or messageId');
      }

      return step.run('send-follow-up', async () => {
        const ctx = await deps.loadContext(contactId);
        if (ctx.state !== 'sent') return { skipped: `state is ${ctx.state}, not sent` };
        if (!(ctx.followUpsSent < ctx.followUpsDue)) {
          return { skipped: 'no unsent follow-up is due (already sent)' };
        }
        const { providerRef } = await deps.send({ contactId, caseId, messageId, kind: 'follow_up' });
        await applyTransition(deps, contactId, { type: 'APPROVED_SENT' }, deps.clock.now());
        return { sent: true, providerRef };
      });
    },
  };
}
