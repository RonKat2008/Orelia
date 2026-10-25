/**
 * DEMO ONLY: the server-side demo coordinator. It plays a fictional intake coordinator behind each demo coordinator
 * inbox and answers the case's outreach email with "please send records", so the reply -> records card -> tracker loop
 * runs without anyone keeping a laptop script (scripts/demo-coordinators.ts) running. Driven by the cron tick
 * (every minute) and by the demo console's "Deliver replies now" button.
 *
 * Safety:
 *   - Off unless demo destinations are on (WAYFINDER_DEMO_COORDINATORS=1 plus an allowlisted coordinator inbox)
 *     and AGENTMAIL_API_KEY is set.
 *   - It only ever replies from a coordinator inbox (which is on OUTBOUND_ALLOWLIST), in a thread that Wayfinder itself
 *     started (an outbound message with that provider thread id exists in our database), and never to a coordinator
 *     address. A reply in such a thread goes back to our own case inbox, so it cannot reach a third party.
 *   - One scripted reply per provider thread, ever: claimed in the OnceStore before sending (overlapping cron runs
 *     cannot double-reply). A failure before the provider accepted the reply releases the claim for a retry.
 */
import type { DemoMail, DemoMessage } from '../../scripts/demo/mail';
import { extractAddress } from '../../scripts/demo/coordinator-engine';
import { demoCoordinatorInboxes } from '../outreach/demo-coordinators';
import { demoDestinationsEnabled } from '../outreach/demo-destinations';
import { onceKey, type OnceStore } from '../workflows/once';

type Env = Record<string, string | undefined>;

/** The scripted coordinator answer. Generic, no medical advice; classified as send_records by the inbox agent. */
export const DEMO_RECORDS_REPLY = [
  'Thank you for reaching out on the patient\'s behalf.',
  '',
  'Before we can offer a new-patient appointment, please send the patient\'s most recent medical records, including the genetic test report and any imaging reports. Once we have them, our team will review and contact the patient to schedule.',
  '',
  '— Intake Coordinator, Wayfinder Demo Clinic (fictional, demo only)',
].join('\n');

/** Only mail this recent is answered (a coordinator inbox also holds older demo traffic). */
export const RESPONDER_LOOKBACK_MS = 6 * 60 * 60 * 1000;
/** A coordinator "reads" mail after this long, so the presenter sees sent -> replied as two beats. */
export const DEFAULT_REPLY_DELAY_MS = 15_000;

export interface ResponderResult {
  enabled: boolean;
  scanned: number;
  replied: number;
  skipped: number;
  failed: number;
}

export function responderEnabled(env: Env): boolean {
  return demoDestinationsEnabled(env) && Boolean(env.AGENTMAIL_API_KEY?.trim());
}

export async function runDemoResponder(opts: {
  env: Env;
  mail: DemoMail;
  once: OnceStore;
  now: Date;
  delayMs?: number;
  /** Ignore mail received before this (e.g. only one demo case's start). */
  notBefore?: Date;
  /** True when Wayfinder sent the first message of this provider thread (our own outbound row exists). */
  isOurThread: (threadId: string) => Promise<boolean>;
  /** True for a thread that must stay unanswered (its plan calls when there is no reply), so the follow-up fires. */
  isSilentThread?: (threadId: string) => Promise<boolean>;
  log?: (line: string) => void;
}): Promise<ResponderResult> {
  const result: ResponderResult = { enabled: responderEnabled(opts.env), scanned: 0, replied: 0, skipped: 0, failed: 0 };
  if (!result.enabled) return result;
  const coordinatorAddresses = new Set(demoCoordinatorInboxes(opts.env));
  // AgentMail inbox ids are the inbox addresses, so no account-wide listing (which scoped keys may not allow) is needed.
  const coordinators = [...coordinatorAddresses].map((address) => ({ inboxId: address, address }));
  const delay = opts.delayMs ?? DEFAULT_REPLY_DELAY_MS;
  const floor = Math.max(opts.now.getTime() - RESPONDER_LOOKBACK_MS, opts.notBefore?.getTime() ?? 0);

  for (const inbox of coordinators) {
    const received = await opts.mail.listReceived(inbox.inboxId);
    // Oldest first: the first message of a thread is the one we answer.
    const ordered = [...received].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    for (const m of ordered) {
      const at = Date.parse(m.receivedAt);
      if (!Number.isFinite(at) || at < floor) continue;
      result.scanned += 1;
      if (!replyAllowed(m, coordinatorAddresses) || opts.now.getTime() < at + delay || !(await opts.isOurThread(m.threadId).catch(() => false))) {
        result.skipped += 1;
        continue;
      }
      if (opts.isSilentThread && (await opts.isSilentThread(m.threadId).catch(() => false))) {
        result.skipped += 1;
        continue;
      }
      const key = onceKey('demo-reply-thread', m.threadId);
      if (!(await opts.once.claim(key, opts.now))) {
        result.skipped += 1;
        continue;
      }
      try {
        await opts.mail.reply(inbox.inboxId, m.messageId, DEMO_RECORDS_REPLY);
        result.replied += 1;
        opts.log?.(`[demo-responder] replied in thread ${m.threadId.slice(-8)}`);
      } catch (err) {
        result.failed += 1;
        await opts.once.release(key).catch(() => undefined);
        console.error('[demo-responder] reply failed', err instanceof Error ? err.name : 'error');
      }
    }
  }
  return result;
}

/** Never answer a coordinator's own mail (that would loop between demo inboxes). */
export function replyAllowed(m: Pick<DemoMessage, 'from'>, coordinatorAddresses: Set<string>): boolean {
  const from = extractAddress(m.from);
  return from.includes('@') && !coordinatorAddresses.has(from);
}
