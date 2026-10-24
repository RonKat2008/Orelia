/**
 * Workflow events without Inngest.
 *
 * When Inngest is not configured, the parts of the workflow that are immediate
 * still run inside the request: an approved follow-up is sent (through the same
 * gated sender), and a reply moves the contact to `replied`. Only the durable
 * timers (business-day 3/7 follow-ups, stall at day 10) are not scheduled; the
 * tracker says so ("Automatic follow-ups are paused until scheduling is connected").
 *
 * Nothing here can send by itself: the only send path is the injected
 * `deps.send`, and the follow-up workflow re-reads messages.approved_at first.
 */
import { CONTACT_APPROVED, CONTACT_REPLY, FOLLOW_UP_APPROVED, type WorkflowStep } from './engine';
import { transition } from './connection-machine';
import { createFollowUpSendWorkflow, type ConnectionDeps } from './connection-workflow';
import { inngestSendEvents, type SendEvents, type WorkflowEvent } from './events';
import { OutreachError } from '../outreach/types';

type Env = Record<string, string | undefined>;

const set = (v: string | undefined) => (v ?? '').trim() !== '';

/** True when durable scheduling works: both Inngest keys, or a local Inngest dev server. */
export function schedulingConnected(env: Env = process.env): boolean {
  const devServer = set(env.INNGEST_DEV) && env.INNGEST_DEV !== '0';
  return devServer || (set(env.INNGEST_EVENT_KEY) && set(env.INNGEST_SIGNING_KEY));
}

/** Runs step functions immediately. Waiting and fan-out need a durable engine, so they are refused/dropped. */
function inlineStep(): WorkflowStep {
  return {
    run: async (_id, fn) => fn(),
    async waitForEvent() {
      throw new Error('waitForEvent needs durable scheduling (Inngest); not available inline');
    },
    async sendEvent() {
      return undefined;
    },
  };
}

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

/** Handles workflow events in-process. contact/approved is a no-op: the first message was already sent. */
export function inlineSendEvents(getDeps: () => ConnectionDeps): SendEvents {
  return async (events) => {
    for (const event of Array.isArray(events) ? events : [events]) {
      if (event.name === FOLLOW_UP_APPROVED) await followUpApproved(getDeps(), event);
      else if (event.name === CONTACT_REPLY) await replyReceived(getDeps(), event);
      else if (event.name === CONTACT_APPROVED) continue; // follow-up timers are not scheduled
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
