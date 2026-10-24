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

type Env = Record<string, string | undefined>;

export function createDurableDeps(opts: {
  store: ContactContextStore;
  send: ConnectionDeps['send'];
  env?: Env;
}): ConnectionDeps {
  const { store, send } = opts;
  return {
    clock: systemClock(opts.env ?? process.env),
    send,
    loadContext: (contactId) => store.load(contactId),
    saveContext: (contactId, ctx) => store.save(contactId, ctx),
    draftFollowUp: (input) => store.createFollowUpDraft(input),
    loadMessageApproval: (messageId) => store.loadMessageApproval(messageId),
    loadThread: (contactId) => store.loadThread(contactId),
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
