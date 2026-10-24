import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { caseInputSchema, type CaseInput } from "@/lib/contracts";
import { OPUS } from "./models";
import { buildSystemPrompt } from "./prompts/common";
import type { RunStore } from "./run-store";
import { MemoryRunStore } from "./run-store";
import { runAgent } from "./runtime";

const SYSTEM = buildSystemPrompt(`ROLE: Intake extractor.
Read the pasted clinical report and copy out the case facts needed to FIND resources. Do not interpret them.
Return ONE JSON object with these keys (omit any key the report does not state; never guess):
  diseaseName (string, required), diseaseCodes ({orpha?, mesh?, icd10?}), subtype, stageSummary (copy the
  report's own staging/grade wording; do not assess it), homeCity, homeState (2-letter), insurer, planId,
  travelLimitMiles (integer), goals (array of: second_opinion | treatment | trial | support | aid).
Only use goals the patient/report states. Ignore names, dates of birth, accession numbers and any other identifiers.
You have no tools.`);

const REPORT_DIR = path.join(process.cwd(), "fixtures", "reports");
const FIXTURE_HINTS: [RegExp, string][] = [
  [/epithelioid sarcoma/i, "epithelioid-sarcoma"],
  [/igg4/i, "igg4-related-disease"],
  [/ehlers|vascular eds/i, "vascular-eds"],
];

/** Offline only: find which recorded fixture a pasted synthetic report corresponds to. */
export async function offlineKeyFor(reportText: string): Promise<string> {
  const files = (await readdir(REPORT_DIR)).filter((f) => f.endsWith(".md"));
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const f of files) {
    if (norm(await readFile(path.join(REPORT_DIR, f), "utf8")) === norm(reportText)) return f.replace(/\.md$/, "");
  }
  const hit = FIXTURE_HINTS.find(([re]) => re.test(reportText));
  if (hit) return hit[1];
  throw new Error("Offline mode: report does not match any synthetic fixture report");
}

export interface ExtractOptions {
  /** Fixture stem under fixtures/llm/intake-extractor/. Derived from the text when omitted. */
  offlineKey?: string;
  store?: RunStore;
}

/**
 * Extract a CaseInput from report text (Opus). No case exists yet, so the agent_runs bookkeeping goes
 * to a throwaway in-memory store unless one is given (agent_runs.case_id is a FK to cases).
 */
export async function extractCase(reportText: string, opts: ExtractOptions = {}): Promise<CaseInput> {
  const offlineKey = opts.offlineKey ?? (await offlineKeyFor(reportText).catch(() => "unknown"));
  return runAgent<CaseInput>({
    name: "intake-extractor",
    model: OPUS,
    system: SYSTEM,
    prompt: `REPORT:\n"""\n${reportText}\n"""\n\nReturn the JSON object now.`,
    tools: [],
    output: caseInputSchema,
    caseId: "00000000-0000-0000-0000-000000000000",
    store: opts.store ?? new MemoryRunStore(),
    offlineKey,
  });
}
