import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDemoMail } from "./demo/agentmail-mail";
import type { DemoMail } from "./demo/mail";
import { seedCase } from "./demo/seed-case";
import {
  loadCoordinatorSpecs,
  loadState,
  saveState,
  statePath,
  type DemoState,
} from "./demo/state";

type Env = Record<string, string | undefined>;

export interface SeedResult {
  mode: "dry-run" | "agentmail";
  reason: string;
  state: DemoState;
  allowlist: string;
  caseWritten: boolean;
  created: string[];
  reused: string[];
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Env = process.env,
  deps: { mail?: DemoMail; log?: (line: string) => void } = {},
): Promise<SeedResult> {
  const log = deps.log ?? console.log;
  const wantsLive = argv.includes("--live") && !argv.includes("--dry-run");
  // Only the real process environment may pull in .env.local, and only in live mode.
  if (wantsLive && env === process.env) {
    dotenv.config({ path: ".env.local", quiet: true });
  }

  const hasKey = Boolean(env.AGENTMAIL_API_KEY);
  const live = wantsLive && hasKey;
  const reason = live
    ? "--live passed and AGENTMAIL_API_KEY is set"
    : argv.includes("--dry-run")
      ? "--dry-run passed"
      : wantsLive
        ? "--live passed but AGENTMAIL_API_KEY is missing, falling back to dry-run"
        : "default (pass --live with AGENTMAIL_API_KEY for real test inboxes)";
  log(`Mode: ${live ? "LIVE (AgentMail test inboxes)" : "DRY-RUN (no network)"}: ${reason}`);

  const mail = deps.mail ?? createDemoMail({ dryRun: !live, env });
  const specs = loadCoordinatorSpecs();
  const prior = loadState();
  const priorUsable = prior && prior.mode === mail.mode ? prior : null;
  const existing = await mail.listInboxes();

  const coordinators: DemoState["coordinators"] = [];
  const created: string[] = [];
  const reused: string[] = [];
  for (const spec of specs) {
    const fromState = priorUsable?.coordinators.find((c) => c.username === spec.username);
    const fromList = existing.find((i) => i.address.split("@")[0] === spec.username);
    const inbox =
      fromList ??
      (fromState && { inboxId: fromState.inboxId, address: fromState.address, displayName: fromState.displayName });
    if (inbox) {
      reused.push(spec.key);
      coordinators.push({ ...spec, ...inbox });
    } else {
      const made = await mail.createInbox({ username: spec.username, displayName: spec.displayName });
      created.push(spec.key);
      coordinators.push({ ...spec, ...made });
    }
  }

  const reportIdx = argv.indexOf("--report");
  const reportName = reportIdx >= 0 ? argv[reportIdx + 1] : undefined;
  let caseId = priorUsable?.caseId ?? null;
  let caseWritten = false;
  if (!caseId) {
    const res = await seedCase({
      reportName,
      live: wantsLive,
      databaseUrl: env.DATABASE_URL,
      log,
    });
    caseId = res.caseId;
    caseWritten = res.written;
  } else {
    log(`Reusing case ${caseId}`);
  }

  const state: DemoState = {
    mode: mail.mode,
    createdAt: priorUsable?.createdAt ?? new Date().toISOString(),
    coordinators,
    caseId,
    repliedMessageIds: priorUsable?.repliedMessageIds ?? [],
  };
  saveState(state);

  const allowlist = coordinators.map((c) => c.address).join(",");
  log("");
  log(`Inboxes created: ${created.length}, reused: ${reused.length}`);
  for (const c of coordinators) log(`  ${c.key.padEnd(9)} ${c.address}  (${c.scenario})`);
  log(`State written to ${statePath(env)}`);
  log("");
  log("Add this to your environment yourself (this script never writes env files):");
  log(`OUTBOUND_ALLOWLIST=${allowlist}`);
  log("");
  log("Next steps:");
  log(`  npx tsx scripts/demo-coordinators.ts${live ? " --live" : " --dry-run"}   # start the fictional coordinators`);
  log(`  npx tsx scripts/demo-reset.ts${live ? " --live" : ""}                  # tear down when finished`);

  return { mode: mail.mode, reason, state, allowlist, caseWritten, created, reused };
}


const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
