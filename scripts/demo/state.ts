import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoordinatorSpec, DemoInbox } from "./mail";

/** Shared demo state: which coordinator inboxes exist and which messages were answered. */
export interface DemoState {
  mode: "dry-run" | "agentmail";
  createdAt: string;
  coordinators: (CoordinatorSpec & DemoInbox)[];
  caseId: string | null;
  repliedMessageIds: string[];
}

export function statePath(env: Record<string, string | undefined> = process.env): string {
  const override = env.WAYFINDER_DEMO_STATE;
  return override && override.length > 0
    ? override
    : path.join(os.tmpdir(), "wayfinder-demo", "state.json");
}

/** Directory holding the state file (dry-run mail data lives beside it). */
export function stateDir(): string {
  return path.dirname(statePath());
}

export function loadState(): DemoState | null {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    return JSON.parse(raw) as DemoState;
  } catch {
    return null;
  }
}

export function saveState(state: DemoState): void {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function clearState(): void {
  fs.rmSync(statePath(), { force: true });
}

function repoRoot(): string {
  try {
    // scripts/demo/state.ts -> repo root is two levels up
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  } catch {
    return process.cwd();
  }
}

export function loadCoordinatorSpecs(): CoordinatorSpec[] {
  const candidates = [
    path.join(repoRoot(), "fixtures", "demo", "coordinators.json"),
    path.join(process.cwd(), "fixtures", "demo", "coordinators.json"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        coordinators: CoordinatorSpec[];
      };
      return parsed.coordinators;
    }
  }
  throw new Error("fixtures/demo/coordinators.json not found");
}
