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
  CONTACT_RESTART,
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
    /** Present only for follow-ups that already have an AgentMail thread. */
    thread?: { inboxId?: string; threadId?: string; messageId: string };
  }): Promise<{ providerRef: string }>;
  /**
   * Human approval lives on the messages row. Event payloads are not trusted:
   * a missing or invalid approved_at means this returns null and nothing is sent.
   */
  loadMessageApproval(messageId: string): Promise<string | null>;
  /** Original outbound provider ids so a follow-up can reply in-thread. */
  loadThread?(contactId: string): Promise<{ inboxId?: string; threadId?: string; messageId: string } | null>;
  loadContext(contactId: string): Promise<ContactContext>;
  saveContext(contactId: string, ctx: ContactContext): Promise<void>;
  /** Creates an UNAPPROVED draft for the patient to review; never sends. */
  draftFollowUp(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
  }): Promise<{ messageId: string }>;
  /**
   * Walk-away mode. send = the stored pre-approved body is still valid.
   * hold = do not send it; the patient must approve something else.
   * Omitted means the historical draft-only cadence.
   */
  resolvePreapproved?(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
  }): Promise<{ action: 'send'; messageId: string; body: string } | { action: 'hold'; reason: string }>;
  notifyApprovalNeeded?(input: {
    contactId: string;
    caseId: string;
    followUpNumber: 1 | 2;
    reason: string;
  }): Promise<void>;
  cancelPreapproved?(input: { contactId: string; reason: 'reply' | 'decline' | 'revoke' }): Promise<void>;
}

type Phase = 'followUp1' | 'followUp2' | 'stall';
const PHASES: Phase[] = ['followUp1', 'followUp2', 'stall'];

function matchContact(contactId: string): string {
  // JSON.stringify yields a safely escaped string literal for the CEL-like expression.
  return `async.data.contactId == ${JSON.stringify(contactId)}`;
}

async function persistedApproval(deps: ConnectionDeps, messageId: string): Promise<string | null> {
  const approvedAt = await deps.loadMessageApproval(messageId);
  if (!approvedAt || Number.isNaN(new Date(approvedAt).getTime())) return null;
  return new Date(approvedAt).toISOString();
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
          // Event approvedAt is ignored. Only the messages.approved_at column may authorize a send.
          const approvedAt = await persistedApproval(deps, messageId);
          if (!approvedAt) return { state: 'unapproved' as string, firstSentAt: null as string | null };
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
            await deps.cancelPreapproved?.({ contactId, reason: 'reply' });
            return { ok: true };
          });
          return { outcome: 'replied' };
        }

        // Timed out. When the clock is accelerated the real wall time is far
        // before the real business-day deadline, so the machine's "not due yet"
        // check would reject FOLLOW_UP_DUE. Use max(now, unscaled real deadline).
        const due = await step.run(`follow-up-due-${phase}`, async () => {
          const ctx = await deps.loadContext(contactId);
          if (ctx.state === 'declined' || ctx.state === 'replied') {
            await deps.cancelPreapproved?.({ contactId, reason: ctx.state === 'declined' ? 'decline' : 'reply' });
            return { skipped: ctx.state as string, effects: [] as { type: string; followUpNumber?: number }[] };
          }
          const real = new Date(deadline.real);
          const now = deps.clock.now();
          const at = now.getTime() > real.getTime() ? now : real;
          const res = await applyTransition(deps, contactId, { type: 'FOLLOW_UP_DUE' }, at);
          return { skipped: null as string | null, effects: res.effects.map((e) => ({ ...e })) as { type: string; followUpNumber?: number }[] };
        });
        if (due.skipped) return { outcome: due.skipped };

        for (const effect of due.effects) {
          if (effect.type === 'DRAFT_FOLLOW_UP') {
            const followUpNumber = effect.followUpNumber as 1 | 2;
            const pre = deps.resolvePreapproved
              ? await step.run(`resolve-preapproved-${followUpNumber}`, () =>
                  deps.resolvePreapproved!({ contactId, caseId, followUpNumber }),
                )
              : { action: 'none' as const };
            if (pre.action === 'send') {
              const sent = await step.run(`send-preapproved-${followUpNumber}`, async () => {
                const approvedAt = await persistedApproval(deps, pre.messageId);
                if (!approvedAt) return { sent: false as const };
                const thread = (await deps.loadThread?.(contactId)) ?? undefined;
                await deps.send({
                  contactId, caseId, messageId: pre.messageId, kind: 'follow_up', ...(thread ? { thread } : {}),
                });
                await applyTransition(deps, contactId, { type: 'APPROVED_SENT' }, deps.clock.now());
                return { sent: true as const };
              });
              if (sent.sent) continue;
            }
            if (pre.action === 'hold') {
              await step.run(`notify-approval-${followUpNumber}`, async () => {
                await deps.notifyApprovalNeeded?.({ contactId, caseId, followUpNumber, reason: pre.reason });
                return { notified: true };
              });
            }
            // Unapproved draft. A later FOLLOW_UP_APPROVED event is what sends it.
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

/**
 * A reply that arrives after the contact is already stalled moves it back to
 * `replied` and starts a fresh connection run. In-flight waits still handle
 * replies that arrive before the stall.
 */
export function createStalledRevivalWorkflow(deps: ConnectionDeps): FunctionDefinition {
  return {
    id: 'contact-stalled-revival',
    trigger: { event: CONTACT_REPLY },
    idempotency: 'event.data.dedupeKey',
    async handler({ event, step }) {
      const { contactId, caseId } = event.data ?? {};
      if (!contactId || !caseId) throw new Error('contact/reply missing contactId or caseId');
      const revived = await step.run('revive-if-stalled', async () => {
        const ctx = await deps.loadContext(contactId);
        if (ctx.state !== 'stalled') return { revived: false, state: ctx.state as string };
        await applyTransition(deps, contactId, { type: 'REPLY_RECEIVED' }, deps.clock.now());
        await deps.cancelPreapproved?.({ contactId, reason: 'reply' });
        return { revived: true, state: 'replied' };
      });
      if (!revived.revived) return revived;
      const restartKey = String(event.data.dedupeKey ?? event.data.messageId ?? contactId);
      await step.sendEvent('restart-connection', {
        name: CONTACT_RESTART,
        data: { contactId, caseId, restartKey, messageId: event.data.messageId ?? null },
      });
      return { revived: true, state: 'replied', restarted: true };
    },
  };
}

/** Resumes a revived contact. Sends nothing: state is already `replied`, and approval is re-read if a send is ever reached. */
export function createConnectionRestartWorkflow(deps: ConnectionDeps): FunctionDefinition {
  return {
    id: 'contact-connection-restart',
    trigger: { event: CONTACT_RESTART },
    idempotency: 'event.data.restartKey',
    async handler({ event, step }) {
      const { contactId, caseId, messageId } = event.data ?? {};
      if (!contactId || !caseId) throw new Error('contact/connection.restart missing contactId or caseId');
      return createConnectionWorkflow(deps).handler({
        event: {
          name: CONTACT_APPROVED,
          data: {
            contactId,
            caseId,
            messageId: typeof messageId === 'string' ? messageId : 'restart',
            // Placeholder only. send-initial re-reads messages.approved_at and will not send on it.
            approvedAt: new Date(0).toISOString(),
          },
        },
        step,
      });
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
        const approvedAt = await persistedApproval(deps, messageId);
        if (!approvedAt) return { skipped: 'message is not approved in the database' };
        const thread = (await deps.loadThread?.(contactId)) ?? undefined;
        const { providerRef } = await deps.send({
          contactId, caseId, messageId, kind: 'follow_up', ...(thread ? { thread } : {}),
        });
        await applyTransition(deps, contactId, { type: 'APPROVED_SENT' }, deps.clock.now());
        return { sent: true, providerRef };
      });
    },
  };
}
