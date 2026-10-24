import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caseInputSchema, type CaseInput } from "../../lib/contracts";

function reportsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "fixtures", "reports", "expected");
}

/** Strip null / undefined (fixtures use null for unknown codes) before validating. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, clean(v)]),
    ) as T;
  }
  return value;
}

/** Build a validated case insert object from a synthetic expected-extraction fixture. */
export function buildDemoCase(reportName = "epithelioid-sarcoma"): CaseInput {
  const file = path.join(reportsDir(), `${reportName}.json`);
  if (!fs.existsSync(file)) throw new Error(`No fixture report named "${reportName}" (${file})`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  return caseInputSchema.parse(clean(raw));
}

export interface SeedCaseResult {
  caseId: string;
  written: boolean;
}

export async function seedCase(opts: {
  reportName?: string;
  live?: boolean;
  databaseUrl?: string;
  log?: (line: string) => void;
}): Promise<SeedCaseResult> {
  const log = opts.log ?? console.log;
  const name = opts.reportName ?? "epithelioid-sarcoma";
  const input = buildDemoCase(name);
  if (!opts.live || !opts.databaseUrl) {
    const caseId = `dry-run-case-${name}`;
    log(`Case NOT written to any database (dry-run). Using placeholder id ${caseId}.`);
    return { caseId, written: false };
  }
  const { createDb } = await import("../../db/client");
  const { cases } = await import("../../db/schema");
  const db = createDb(opts.databaseUrl);
  const [row] = await db
    .insert(cases)
    .values(input)
    .returning({ id: cases.id });
  log(`Case inserted into database: ${row.id}`);
  return { caseId: row.id, written: true };
}
