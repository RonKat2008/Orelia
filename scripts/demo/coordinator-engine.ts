/**
 * Pure planning logic for the fictional demo coordinators. No I/O, clock injected.
 *
 * Safety: coordinators reply ONLY to senders on an explicit allowlist (our own
 * Wayfinder case inboxes). An empty allowlist means they reply to nobody.
 */
import type { CoordinatorSpec, DemoInbox, DemoMessage } from './mail';

export type Coordinator = CoordinatorSpec & DemoInbox;

export interface PlannedReply {
  coordinatorKey: string;
  inboxId: string;
  messageId: string;
  threadId: string;
  to: string;
  text: string;
  dueAt: number;
}

export interface PendingReply {
  coordinatorKey: string;
  inboxId: string;
  messageId: string;
  reason: string;
}

export interface ReplyPlan {
  due: PlannedReply[];
  pending: PendingReply[];
}

/** Extract the bare lowercase address from `"Name" <a@b>`, `Name <a@b>` or `a@b`. */
export function extractAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

function splitList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => extractAddress(s))
    .filter((s) => s.length > 0);
}

/**
 * Reply targets come from DEMO_REPLY_ALLOWLIST (our Wayfinder case inboxes).
 * Falls back to OUTBOUND_ALLOWLIST entries that are not coordinator addresses.
 */
export function parseReplyAllowlist(
  env: Record<string, string | undefined>,
  coordinatorAddresses: string[] = [],
): string[] {
  const explicit = splitList(env.DEMO_REPLY_ALLOWLIST);
  if (explicit.length > 0) return [...new Set(explicit)];
  const coord = new Set(coordinatorAddresses.map(extractAddress));
  const fallback = splitList(env.OUTBOUND_ALLOWLIST).filter((a) => !coord.has(a));
  return [...new Set(fallback)];
}

/**
 * Equivalent of parseTimeScale in lib/workflows/clock.ts (not merged in this
 * worktree yet): WAYFINDER_SIM_TIME_SCALE, a positive finite number, default 1.
 */
export function parseTimeScale(env: Record<string, string | undefined>): number {
  const n = Number(env.WAYFINDER_SIM_TIME_SCALE);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface PlanInput {
  coordinators: Coordinator[];
  received: Map<string, DemoMessage[]>;
  repliedMessageIds: string[];
  allowlist: string[];
  now: number; // epoch ms
  timeScale: number;
}

/**
 * Decide which received messages get a scripted reply now.
 * - 'silent' coordinators never reply (this triggers the day-3 follow-up).
 * - Sender must be on the allowlist (case-insensitive exact address match).
 * - Due when now >= receivedAt + delaySeconds*1000/timeScale.
 * - One scripted reply per thread per coordinator: later messages in a thread
 *   that already got a reply (e.g. a follow-up) get no second scripted reply.
 */
export function planReplies(input: PlanInput): ReplyPlan {
  const allow = new Set(input.allowlist.map(extractAddress));
  const replied = new Set(input.repliedMessageIds);
  const scale = input.timeScale > 0 && Number.isFinite(input.timeScale) ? input.timeScale : 1;
  const due: PlannedReply[] = [];
  const pending: PendingReply[] = [];

  const ordered = [...input.coordinators].sort((a, b) => a.key.localeCompare(b.key));
  for (const c of ordered) {
    const msgs = [...(input.received.get(c.inboxId) ?? [])].sort(
      (a, b) =>
        Date.parse(a.receivedAt) - Date.parse(b.receivedAt) ||
        a.messageId.localeCompare(b.messageId),
    );
    const repliedThreads = new Set(
      msgs.filter((m) => replied.has(m.messageId)).map((m) => m.threadId),
    );
    for (const m of msgs) {
      if (replied.has(m.messageId)) continue;
      const base = { coordinatorKey: c.key, inboxId: c.inboxId, messageId: m.messageId };
      if (c.scenario === 'silent' || c.reply === null || c.delaySeconds === null) {
        pending.push({ ...base, reason: 'silent coordinator never replies' });
        continue;
      }
      const sender = extractAddress(m.from);
      if (!allow.has(sender)) {
        pending.push({ ...base, reason: `sender ${sender} not on reply allowlist` });
        continue;
      }
      if (repliedThreads.has(m.threadId)) {
        pending.push({ ...base, reason: 'thread already received a scripted reply' });
        continue;
      }
      const dueAt = Date.parse(m.receivedAt) + (c.delaySeconds * 1000) / scale;
      if (input.now < dueAt) {
        pending.push({ ...base, reason: `not due until ${new Date(dueAt).toISOString()}` });
        continue;
      }
      repliedThreads.add(m.threadId);
      due.push({ ...base, threadId: m.threadId, to: sender, text: c.reply, dueAt });
    }
  }
  due.sort((a, b) => a.dueAt - b.dueAt || a.messageId.localeCompare(b.messageId));
  return { due, pending };
}
