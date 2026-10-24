import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { checkEnv, requirementSatisfied, requirementsFor, resolveMode, type EnvMode } from "../lib/env";

type Source = Record<string, string | undefined>;
const MODES: EnvMode[] = ["offline", "dev", "demo", "prod"];

/**
 * Usage: npx tsx scripts/check-env.ts [--mode prod|demo|dev|offline] [--strict] [--no-dotenv]
 * Prints names only, never values. Returns the exit code.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  source: Source = process.env,
  log: (line: string) => void = console.log,
): number {
  const strict = argv.includes("--strict");
  let mode: EnvMode | undefined;
  const mi = argv.findIndex((a) => a === "--mode" || a.startsWith("--mode="));
  if (mi >= 0) {
    const raw = argv[mi].includes("=") ? argv[mi].split("=")[1] : argv[mi + 1];
    if (!MODES.includes(raw as EnvMode)) {
      log(`Invalid --mode (expected one of: ${MODES.join(", ")})`);
      return 2;
    }
    mode = raw as EnvMode;
  }

  let effective: Source = source;
  if (source === process.env && !argv.includes("--no-dotenv")) {
    const file = path.resolve(process.cwd(), ".env.local");
    if (existsSync(file)) effective = { ...dotenv.parse(readFileSync(file)), ...source };
  }

  const resolved = mode ?? resolveMode(effective);
  const report = checkEnv(resolved, effective);
  log(`Mode: ${report.mode}`);

  const reqs = requirementsFor(report.mode, effective);
  if (reqs.length === 0) {
    log("Required: (none)");
  } else {
    log("Required:");
    for (const r of reqs) {
      log(`  ${requirementSatisfied(r, effective) ? "✓ set    " : "✗ missing"}  ${r.name}  - ${r.why}`);
    }
  }
  if (report.warnings.length) {
    log("Warnings:");
    for (const w of report.warnings) log(`  ! ${w}`);
  }
  log(`Set: ${report.set.join(", ") || "(none)"}`);
  log(`Unset: ${report.unset.join(", ") || "(none)"}`);

  if (!report.ok) {
    log(`Result: ${report.missing.length} required variable(s) missing${strict ? "" : " (not strict; exiting 0)"}`);
    return strict ? 1 : 0;
  }
  log("Result: ok");
  return 0;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
