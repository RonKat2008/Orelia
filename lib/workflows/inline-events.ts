/**
 * Workflow events without Inngest.
 *
 * When Inngest is not configured, the parts of the workflow that are immediate
 * still run inside the request: an approved follow-up is sent (through the same
 * gated sender), and a reply moves the contact to `replied`. The business-day 3/7
 * follow-ups and the stall are not durable timers here: contact/approved records
 * contacts.next_follow_up_at, and the Vercel Cron sweep (follow-up-sweep.ts) acts on it.
 * Without CRON_SECRET too, the tracker says follow-ups are paused.
 *
 * Nothing here can send by itself: the only send path is the injected
 * `deps.send`, and the follow-up workflow re-reads messages.approved_at first.
 */
import { CONTACT_APPROVED, CONTACT_REPLY, FOLLOW_UP_APPROVED } from './engine';
import { followUpDeadlines, transition } from './connection-machine';
import { inlineStep } from './follow-up-sweep';
import { schedulingConnected } from './scheduler';
import { createFollowUpSendWorkflow, type ConnectionDeps } from './connection-workflow';
import { inngestSendEvents, type SendEvents, type WorkflowEvent } from './events';
import { OutreachError } from '../outreach/types';

type Env = Record<string, string | undefined>;

export { schedulingConnected } from './scheduler';

function asReasons(err: unknown): string[] | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { name?: unknown; reasons?: unknown };
  if (e.name === 'FollowUpRefusedError' && Array.isArray(e.reasons)) return e.reasons.map(String);
  if (e.name === 'DuplicateSendError') return ['already_approved'];
  return null;
}

async function followUpApproved(deps: ConnectionDeps, event: WorkflowEvent): Promise<void> {
  try {
    await createFollowUpSendWorkflow(deps).handler({ event, step: inlineStep() });
  } catch (err) {
    const reasons = asReasons(err);
    if (!reasons) throw err;
    throw new OutreachError(reasons[0] === 'already_approved' ? 409 : 422, reasons);
  }
}

async function replyReceived(deps: ConnectionDeps, event: WorkflowEvent): Promise<void> {
  const contactId = event.data.contactId;
  if (typeof contactId !== 'string' || !contactId) throw new Error('contact/reply missing contactId');
  const ctx = await deps.loadContext(contactId);
  // Mirrors the durable workflows: a waiting ('sent') contact or a stalled one becomes 'replied'.
  if (ctx.state !== 'sent' && ctx.state !== 'stalled') return;
  const res = transition(ctx, { type: 'REPLY_RECEIVED' }, deps.clock.now(), { tz: deps.tz });
  if (!res.ok) return;
  await deps.saveContext(contactId, res.context);
  await deps.cancelPreapproved?.({ contactId, reason: 'reply' });
}

/** Records when the cron sweep should first look at this contact. Idempotent; sends nothing. */
async function scheduleNextFollowUp(deps: ConnectionDeps, event: WorkflowEvent): Promise<void> {
  const contactId = event.data.contactId;
  if (typeof contactId !== 'string' || !contactId) return;
  const ctx = await deps.loadContext(contactId);
  if (ctx.state !== 'sent' || !ctx.firstSentAt || ctx.nextFollowUpAt || ctx.followUpsDue > 0) return;
  const nextFollowUpAt = followUpDeadlines(ctx.firstSentAt, deps.tz).followUp1;
  await deps.saveContext(contactId, { ...ctx, nextFollowUpAt });
}

/** Handles workflow events in-process. contact/approved only schedules next_follow_up_at: the first message was already sent. */
export function inlineSendEvents(getDeps: () => ConnectionDeps): SendEvents {
  return async (events) => {
    for (const event of Array.isArray(events) ? events : [events]) {
      if (event.name === FOLLOW_UP_APPROVED) await followUpApproved(getDeps(), event);
      else if (event.name === CONTACT_REPLY) await replyReceived(getDeps(), event);
      else if (event.name === CONTACT_APPROVED) await scheduleNextFollowUp(getDeps(), event);
    }
  };
}

async function defaultDeps(env: Env): Promise<ConnectionDeps> {
  const { createDefaultDeps } = await import('./default-deps');
  return createDefaultDeps(env);
}

/**
 * The sender the app should use: Inngest when scheduling is connected, otherwise inline.
 * `getDeps` is injectable for tests; by default it builds the durable (Postgres) deps lazily.
 */
export function workflowSendEvents(env: Env = process.env, getDeps?: () => ConnectionDeps): SendEvents {
  if (schedulingConnected(env)) return inngestSendEvents();
  return async (events) => {
    const deps = getDeps ? getDeps() : await defaultDeps(env);
    await inlineSendEvents(() => deps)(events);
  };
}
