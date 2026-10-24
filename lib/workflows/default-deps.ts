/**
 * Dependencies for the served workflows.
 *
 * - createDefaultDeps(env): without DATABASE_URL, in-memory contexts and a send()
 *   that always refuses. With DATABASE_URL, durable (Postgres) deps whose only
 *   send path is the injected follow-up sender from lib/outreach/channel-wiring.
 * - Nothing in lib/workflows can send except through the injected `send`.
 */
import { systemClock } from './clock';
import { initialContext, type ContactContext } from './connection-machine';
import type { ConnectionDeps } from './connection-workflow';
import { PostgresContactContextStore, type ContactContextStore } from './contact-store';
import { agentMailNotifier } from '../notify/agentmail';
import { notifyPending, type NotifyMailer } from '../notify/service';
import { allowlistFrom, notifyMode } from '../notify/service';
import { PostgresFollowUpPlan, resolvePreapprovedSend } from '../outreach/follow-up-plan';

type Env = Record<string, string | undefined>;

export function createDurableDeps(opts: {
  store: ContactContextStore;
  send: ConnectionDeps['send'];
  env?: Env;
}): ConnectionDeps {
  const { store, send } = opts;
  const env = opts.env ?? process.env;
  const plan = store instanceof PostgresContactContextStore ? new PostgresFollowUpPlan() : null;
  return {
    clock: systemClock(env),
    send,
    loadContext: (contactId) => store.load(contactId),
    saveContext: (contactId, ctx) => store.save(contactId, ctx),
    draftFollowUp: (input) => store.createFollowUpDraft(input),
    loadMessageApproval: (messageId) => store.loadMessageApproval(messageId),
    loadThread: (contactId) => store.loadThread(contactId),
    ...(plan
      ? {
          resolvePreapproved: (input: { contactId: string; followUpNumber: 1 | 2 }) =>
            resolvePreapprovedSend(plan, input),
          cancelPreapproved: (input: { contactId: string; reason: 'reply' | 'decline' | 'revoke' }) =>
            plan.cancelPending(input.contactId, input.reason).then(() => undefined),
          notifyApprovalNeeded: async (input: { caseId: string; reason: string }) => {
            const listed = await plan.list(input.caseId);
            const pending = Math.max(1, listed.followUps.filter((row) => !row.sentAt && !row.approvedAt).length);
            const secret = env.WAYFINDER_NOTIFY_LINK_SECRET;
            const inboxId = env.WAYFINDER_NOTIFY_INBOX_ID;
            if (!secret || !listed.notification.optIn) return;
            const mailer: NotifyMailer = inboxId && env.AGENTMAIL_API_KEY
              ? agentMailNotifier(
                  new (await import('agentmail')).AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY }),
                  inboxId,
                )
              : { async send() { return { id: 'unconfigured' }; } };
            if (!inboxId) return;
            const result = await notifyPending({
              caseId: input.caseId,
              pendingCount: pending,
              state: {
                optIn: listed.notification.optIn,
                patientEmail: listed.notification.patientEmail,
                homeState: listed.notification.homeState,
                lastSentAt: listed.notification.lastSentAt ? new Date(listed.notification.lastSentAt) : null,
                lastDigestOn: listed.notification.lastDigestOn,
              },
              now: new Date(),
              mode: notifyMode(env),
              allowlist: allowlistFrom(env.OUTBOUND_ALLOWLIST),
              outboundAllowReal: env.OUTBOUND_ALLOW_REAL,
              appBaseUrl: env.WAYFINDER_APP_BASE_URL ?? 'http://localhost:3000',
              linkSecret: secret,
              kind: 'immediate',
              mailer,
            });
            if (result.sent) await plan.recordNotify(input.caseId, result);
          },
        }
      : {}),
  };
}

function createInMemoryDeps(env: Env): ConnectionDeps {
  const contexts = new Map<string, ContactContext>();
  let draftSeq = 0;
  return {
    clock: systemClock(env),
    async send() {
      throw new Error('Outbound channel not wired: sends must go through lib/safety checkOutbound and a channel adapter');
    },
    async loadContext(contactId) {
      return contexts.get(contactId) ?? initialContext();
    },
    async saveContext(contactId, ctx) {
      contexts.set(contactId, ctx);
    },
    async draftFollowUp({ contactId, followUpNumber }) {
      draftSeq += 1;
      return { messageId: `draft-${contactId}-${followUpNumber}-${draftSeq}` };
    },
    async loadMessageApproval() {
      return null;
    },
  };
}

export function createDefaultDeps(env: Env = process.env): ConnectionDeps {
  if (!env.DATABASE_URL) return createInMemoryDeps(env);
  return createDurableDeps({
    store: new PostgresContactContextStore(),
    env,
    async send(input) {
      // Dynamic import avoids a module cycle and keeps this package free of channel imports.
      let mod: { createFollowUpSender?: (opts?: { env?: Env }) => ConnectionDeps['send'] };
      try {
        mod = await import('../outreach/channel-wiring');
      } catch (err) {
        throw new Error(
          `Follow-up sender unavailable: lib/outreach/channel-wiring could not be loaded (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (typeof mod.createFollowUpSender !== 'function') {
        throw new Error('Follow-up sender unavailable: lib/outreach/channel-wiring does not export createFollowUpSender');
      }
      return mod.createFollowUpSender({ env })(input);
    },
  });
}
