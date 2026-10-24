import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DryRunMail } from "../../scripts/demo/dry-run-mail";
import { buildDemoCase } from "../../scripts/demo/seed-case";
import { loadState, statePath } from "../../scripts/demo/state";
import { main as reset } from "../../scripts/demo-reset";
import { main as seed } from "../../scripts/seed-demo";

let dir: string;
const quiet = { log: () => undefined };
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-demo-seed-"));
  process.env.WAYFINDER_DEMO_STATE = path.join(dir, "state.json");
});
afterEach(() => {
  delete process.env.WAYFINDER_DEMO_STATE;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildDemoCase", () => {
  it("returns a validated case without null codes", () => {
    const c = buildDemoCase();
    expect(c.diseaseName).toBe("Epithelioid sarcoma");
    expect(c.diseaseCodes).toEqual({ icd10: "C49.9" });
    expect(c.goals).toContain("second_opinion");
  });
});

describe("seed-demo main", () => {
  it("creates 4 dry-run inboxes, prints the allowlist, writes state, and is idempotent", async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const r1 = await seed(["--dry-run"], {}, { log });
    expect(r1.mode).toBe("dry-run");
    expect(r1.state.coordinators).toHaveLength(4);
    for (const c of r1.state.coordinators) expect(c.address.endsWith(".invalid")).toBe(true);
    const line = lines.find((l) => l.startsWith("OUTBOUND_ALLOWLIST="));
    expect(line).toBeDefined();
    for (const c of r1.state.coordinators) expect(line).toContain(c.address);
    expect(r1.caseWritten).toBe(false);
    expect(r1.state.caseId).toBe("dry-run-case-epithelioid-sarcoma");
    expect(fs.existsSync(statePath())).toBe(true);

    const r2 = await seed(["--dry-run"], {}, quiet);
    expect(r2.created).toHaveLength(0);
    expect(r2.reused).toHaveLength(4);
    expect(await new DryRunMail().listInboxes()).toHaveLength(4);
    expect(r2.state.createdAt).toBe(r1.state.createdAt);
  });

  it("falls back to dry-run when --live has no AGENTMAIL_API_KEY", async () => {
    const r = await seed(["--live"], {}, quiet);
    expect(r.mode).toBe("dry-run");
    expect(r.reason).toContain("missing");
  });

  it("defaults to dry-run without flags even when a key is present", async () => {
    const r = await seed([], { AGENTMAIL_API_KEY: "k" }, quiet);
    expect(r.mode).toBe("dry-run");
  });
});

describe("demo-reset main", () => {
  it("clears dry-run state and mailbox data", async () => {
    await seed([], {}, quiet);
    expect(loadState()).not.toBeNull();
    const r = await reset([], {}, quiet);
    expect(r.stateCleared).toBe(true);
    expect(loadState()).toBeNull();
    expect(await new DryRunMail().listInboxes()).toHaveLength(0);
  });

  it("is a no-op without state", async () => {
    const r = await reset([], {}, quiet);
    expect(r.stateCleared).toBe(false);
  });

  it("keeps state for agentmail-mode state unless --live with key", async () => {
    await seed([], {}, quiet);
    const s = loadState()!;
    fs.writeFileSync(statePath(), JSON.stringify({ ...s, mode: "agentmail" }));
    const r = await reset([], {}, quiet);
    expect(r.stateCleared).toBe(false);
    expect(r.skippedReason).toBeDefined();
  });
});
