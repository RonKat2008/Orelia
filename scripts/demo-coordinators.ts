/**
 * Runs the fictional demo coordinators: polls their AgentMail test inboxes and
 * sends scripted replies ONLY to allowlisted senders (our Wayfinder case inboxes).
 *
 *   npx tsx scripts/demo-coordinators.ts [--dry-run] [--live] [--once] [--interval 5]
 *
 * Live mode requires --live AND AGENTMAIL_API_KEY. Everything else is dry-run.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DemoMail, DemoMessage } from './demo/mail';
import {
  parseReplyAllowlist,
  parseTimeScale,
  BORROWED_LOOKBACK_MS,
  planReplies,
  type Coordinator,
} from './demo/coordinator-engine';
import { loadState, saveState, type DemoState } from './demo/state';
import { createDemoMail } from './demo/agentmail-mail';
import { guardDemoMail } from './demo/reply-guard';

export interface RunDeps {
  mail: DemoMail;
  loadState: () => DemoState | null;
  saveState: (s: DemoState) => void;
  now: () => number;
  env: Record<string, string | undefined>;
  log?: (line: string) => void;
}

export interface RunResult {
  replied: number;
  pending: number;
}

export async function runOnce(deps: RunDeps): Promise<RunResult> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const state = deps.loadState();
  if (!state) {
    throw new Error('No demo state found. Run `npx tsx scripts/seed-demo.ts` first.');
  }
  const coordinators = state.coordinators as Coordinator[];
  const allowlist = parseReplyAllowlist(
    deps.env,
    coordinators.map((c) => c.address),
  );
  if (allowlist.length === 0) {
    log('[warn] No reply allowlist (DEMO_REPLY_ALLOWLIST / OUTBOUND_ALLOWLIST); replying to nobody.');
  }
  const received = new Map<string, DemoMessage[]>();
  for (const c of coordinators) received.set(c.inboxId, await deps.mail.listReceived(c.inboxId));

  const plan = planReplies({
    coordinators,
    received,
    repliedMessageIds: state.repliedMessageIds,
    allowlist,
    now: deps.now(),
    timeScale: parseTimeScale(deps.env),
    ...(state.coordinators.some((c) => c.borrowed) ? { notBefore: Date.parse(state.createdAt) - BORROWED_LOOKBACK_MS } : {}),
  });

  const mail = guardDemoMail(deps.mail, deps.env, coordinators.map((c) => c.address));
  let replied = 0;
  for (const r of plan.due) {
    await mail.reply(r.inboxId, r.messageId, r.text);
    state.repliedMessageIds.push(r.messageId);
    deps.saveState(state);
    replied++;
    log(`[${r.coordinatorKey}] replied to ${r.to} : ${r.text.split('\n')[0].slice(0, 70)}`);
  }
  return { replied, pending: plan.pending.length };
}

function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const interval = Number(get('--interval') ?? 5);
  return {
    dryRun: argv.includes('--dry-run'),
    live: argv.includes('--live'),
    once: argv.includes('--once'),
    interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const live = args.live && !args.dryRun;
  if (live) {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '.env.local' });
  }
  const dryRun = !live || !process.env.AGENTMAIL_API_KEY;
  if (live && dryRun) console.warn('[warn] --live without AGENTMAIL_API_KEY; falling back to dry-run.');
  const mail = createDemoMail({ dryRun, env: process.env });
  console.log(`[coordinators] mode=${mail.mode} interval=${args.interval}s`);

  const deps: RunDeps = {
    mail,
    loadState,
    saveState,
    now: () => Date.now(),
    env: process.env,
  };
  if (args.once) {
    const r = await runOnce(deps);
    console.log(`[coordinators] replied=${r.replied} pending=${r.pending}`);
    return;
  }
  let stop = false;
  process.on('SIGINT', () => {
    stop = true;
    console.log('\n[coordinators] stopping');
  });
  while (!stop) {
    try {
      await runOnce(deps);
    } catch (e) {
      console.error('[coordinators] error:', e instanceof Error ? e.message : e);
    }
    for (let i = 0; i < args.interval * 10 && !stop; i++) await new Promise((r) => setTimeout(r, 100));
  }
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
