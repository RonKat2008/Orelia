import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDemoMail } from "./demo/agentmail-mail";
import { clearDryRunMail } from "./demo/dry-run-mail";
import type { DemoMail } from "./demo/mail";
import { clearState, loadState } from "./demo/state";

type Env = Record<string, string | undefined>;

export interface ResetResult {
  deleted: string[];
  stateCleared: boolean;
  skippedReason?: string;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: Env = process.env,
  deps: { mail?: DemoMail; log?: (line: string) => void } = {},
): Promise<ResetResult> {
  const log = deps.log ?? console.log;
  const wantsLive = argv.includes("--live");
  if (wantsLive && env === process.env) dotenv.config({ path: ".env.local", quiet: true });

  const state = loadState();
  if (!state) {
    clearDryRunMail();
    log("No demo state found; nothing to delete.");
    return { deleted: [], stateCleared: false };
  }

  const deleted: string[] = [];
  if (state.mode === "agentmail") {
    if (!wantsLive || !env.AGENTMAIL_API_KEY) {
      const skippedReason =
        "State refers to real AgentMail inboxes; pass --live with AGENTMAIL_API_KEY to delete them. State kept.";
      log(skippedReason);
      return { deleted, stateCleared: false, skippedReason };
    }
    const mail = deps.mail ?? createDemoMail({ env });
    // Only ever delete inboxes recorded in the state file.
    for (const c of state.coordinators) {
      try {
        await mail.deleteInbox(c.inboxId);
        deleted.push(c.address);
        log(`Deleted ${c.address}`);
      } catch (err) {
        log(`Could not delete ${c.address}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    clearDryRunMail();
    log(`Cleared dry-run mailbox data (${state.coordinators.length} inboxes).`);
  }
  clearState();
  log("Cleared demo state. (Unset OUTBOUND_ALLOWLIST yourself if you exported it.)");
  return { deleted, stateCleared: true };
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
