/**
 * Single choke point for scripted demo replies (hard rule 4). Every demo reply, from the CLI
 * runner and from the /api/demo panel, goes through guardDemoMail, which re-checks the reply
 * target against DEMO_REPLY_ALLOWLIST (or OUTBOUND_ALLOWLIST minus coordinator inboxes) at the
 * moment of sending. An empty allowlist refuses everything.
 */
import { extractAddress, parseReplyAllowlist } from './coordinator-engine';
import type { DemoMail } from './mail';

export class DemoSendRefused extends Error {
  readonly status = 403;
  constructor(address: string) {
    super(`Refused: ${address || 'unknown'} is outside DEMO_REPLY_ALLOWLIST and OUTBOUND_ALLOWLIST`);
  }
}

/** A reply may go only to an address the coordinator engine would accept. */
export function replyPermitted(
  address: string,
  env: Record<string, string | undefined>,
  coordinatorAddresses: string[],
): boolean {
  const allow = parseReplyAllowlist(env, coordinatorAddresses);
  if (allow.length === 0) return false;
  const target = extractAddress(address);
  return allow.some((entry) => entry === target);
}

/** Wrap a DemoMail so reply() throws DemoSendRefused unless the original sender is permitted. */
export function guardDemoMail(
  mail: DemoMail,
  env: Record<string, string | undefined>,
  coordinatorAddresses: string[],
): DemoMail {
  return {
    mode: mail.mode,
    createInbox: (input) => mail.createInbox(input),
    listInboxes: () => mail.listInboxes(),
    deleteInbox: (id) => mail.deleteInbox(id),
    listReceived: (id) => mail.listReceived(id),
    async reply(inboxId, messageId, text) {
      const received = await mail.listReceived(inboxId);
      const original = received.find((m) => m.messageId === messageId);
      const target = original ? extractAddress(original.from) : '';
      if (!original || !replyPermitted(target, env, coordinatorAddresses)) {
        throw new DemoSendRefused(target || messageId);
      }
      return mail.reply(inboxId, messageId, text);
    },
  };
}
