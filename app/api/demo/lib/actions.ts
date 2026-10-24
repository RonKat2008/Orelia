import { isAllowed, parseAllowlist } from "@/lib/safety/allowlist";
import { DemoSendRefused, guardDemoMail, replyPermitted } from "@/scripts/demo/reply-guard";
import { createDemoMail } from "@/scripts/demo/agentmail-mail";
import {
  parseReplyAllowlist,
  parseTimeScale,
  BORROWED_LOOKBACK_MS,
  planReplies,
  type Coordinator,
} from "@/scripts/demo/coordinator-engine";
import type { DemoMail, DemoMessage } from "@/scripts/demo/mail";
import { loadState, type DemoState } from "@/scripts/demo/state";
import { main as seedDemo } from "@/scripts/seed-demo";
import { advanceToDay3, readSimClock, type SimClock } from "./clock";
import { DemoDisabledError, requireDemo } from "./guard";

export interface Destination {
  key: string;
  displayName: string;
  address: string;
  scenario: string;
  /** Present on OUTBOUND_ALLOWLIST. The panel never sends to these itself. */
  onOutboundAllowlist: boolean;
}

export interface DemoStatus {
  seeded: boolean;
  caseId: string | null;
  mode: DemoState["mode"] | null;
  destinations: Destination[];
  replyAllowlist: string[];
  clock: SimClock;
}

function destinations(state: DemoState | null, env: Record<string, string | undefined>): Destination[] {
  const outbound = parseAllowlist(env.OUTBOUND_ALLOWLIST ?? "");
  const rows = state?.coordinators ?? [];
  return rows.map((c) => ({
    key: c.key,
    displayName: c.displayName,
    address: c.address,
    scenario: c.scenario,
    onOutboundAllowlist: isAllowed(c.address, outbound),
  }));
}

export function demoStatus(env: Record<string, string | undefined>, now = new Date()): DemoStatus {
  requireDemo(env);
  const state = loadState();
  const coordinators = (state?.coordinators ?? []) as Coordinator[];
  return {
    seeded: Boolean(state),
    caseId: state?.caseId ?? null,
    mode: state?.mode ?? null,
    destinations: destinations(state, env),
    replyAllowlist: parseReplyAllowlist(
      env,
      coordinators.map((c) => c.address),
    ),
    clock: readSimClock(env, now),
  };
}

/** Dry-run only. Never opens AgentMail, never writes env files. */
export async function seedDemoCase(env: Record<string, string | undefined>) {
  requireDemo(env);
  const isolated: Record<string, string | undefined> = { ...env };
  const result = await seedDemo(["--dry-run"], isolated, { log: () => {} });
  return {
    caseId: result.state.caseId,
    written: result.caseWritten,
    mode: result.mode,
    allowlist: result.allowlist,
    destinations: destinations(result.state, env),
  };
}

export { DemoSendRefused, replyPermitted };

export interface ReplyRun {
  replied: number;
  pending: number;
  refused: string[];
}

export async function triggerScriptedReplies(
  env: Record<string, string | undefined>,
  opts: { now?: number; mail?: DemoMail } = {},
): Promise<ReplyRun> {
  requireDemo(env);
  const state = loadState();
  if (!state) {
    const err = new Error("Seed the demo case before triggering replies.");
    (err as Error & { status: number }).status = 409;
    throw err;
  }
  if (state.mode !== "dry-run") {
    throw new DemoSendRefused("live inboxes are not used by this panel");
  }
  const coordinators = state.coordinators as Coordinator[];
  const addresses = coordinators.map((c) => c.address);
  const permit = (from: string) => replyPermitted(from, env, addresses);
  const mail = guardDemoMail(opts.mail ?? createDemoMail({ dryRun: true, env }), env, addresses);
  const received = new Map<string, DemoMessage[]>();
  for (const c of coordinators) received.set(c.inboxId, await mail.listReceived(c.inboxId));
  const plan = planReplies({
    coordinators,
    received,
    repliedMessageIds: state.repliedMessageIds,
    allowlist: parseReplyAllowlist(env, addresses),
    now: opts.now ?? Date.now(),
    timeScale: parseTimeScale(env),
    ...(coordinators.some((c) => c.borrowed) ? { notBefore: Date.parse(state.createdAt) - BORROWED_LOOKBACK_MS } : {}),
  });

  const refused: string[] = [];
  let replied = 0;
  for (const row of plan.due) {
    if (!permit(row.to)) {
      refused.push(row.to);
      continue;
    }
    await mail.reply(row.inboxId, row.messageId, row.text);
    state.repliedMessageIds.push(row.messageId);
    replied += 1;
  }
  if (replied > 0) {
    const { saveState } = await import("@/scripts/demo/state");
    saveState(state);
  }
  return { replied, pending: plan.pending.length, refused };
}

export function advanceSimulatedTime(env: Record<string, string | undefined>, now = new Date()): SimClock {
  requireDemo(env);
  return advanceToDay3(env, now);
}

export function httpStatus(error: unknown): number {
  if (error instanceof DemoDisabledError || error instanceof DemoSendRefused) return error.status;
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return 500;
}
