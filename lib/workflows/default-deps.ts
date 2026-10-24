/**
 * Default dependencies for the served workflows until the channel adapters
 * (task #7) and a durable contact store land.
 *
 * - send() always refuses: nothing can leave the system from here. The real
 *   implementation must run lib/safety checkOutbound and pass only its ok
 *   payload to a channel adapter.
 * - draftFollowUp() returns a draft id only; drafts are never sent without
 *   a FOLLOW_UP_APPROVED event carrying approvedAt.
 * - Contact contexts live in memory, so they do not survive a restart.
 */
import { systemClock } from './clock';
import { initialContext, type ContactContext } from './connection-machine';
import type { ConnectionDeps } from './connection-workflow';

export function createDefaultDeps(env: Record<string, string | undefined> = process.env): ConnectionDeps {
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
  };
}
