/**
 * Readability check for patient-view copy (DESIGN-v2 section 8 and 11): Flesch-Kincaid grade, longest sentence
 * and banned words. Walks every exported patient copy object (string leaves, and functions called with sample
 * arguments) plus the deterministic status headlines for a set of fixture snapshots.
 *
 *   npx tsx scripts/patient-readability.ts [--json] [--max-grade 8]
 *
 * Exits 1 when the pooled grade of any source is above --max-grade or a banned word appears.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { patientStatus } from "../lib/patient-status/status";
import type { PatientCaseSnapshot, PatientContact } from "../lib/patient-status/types";

const BANNED = ["agent", "agents", "swarm", "curator", "verifier", "allowlist", "resource", "resources", "score", "scores", "rank", "ranked", "tier", "tiers", "pipeline"];
const SAMPLE_ARGS = ["Cleveland Clinic", "records", 3, 9];
const PROSE_MIN_WORDS = 5;

const SOURCES: { name: string; file: string }[] = [
  { name: "intake", file: "components/intake/patient/copy.ts" },
  { name: "home", file: "components/patient/copy.ts" },
  { name: "consent", file: "components/patient/flows/consent/copy.ts" },
  { name: "search", file: "components/patient/views/search/copy.ts" },
  { name: "outbox", file: "components/patient/views/outbox/copy.ts" },
  { name: "tracker", file: "components/patient/views/tracker/copy.ts" },
  { name: "message card", file: "components/patient/actions/MessageCard.tsx" },
  { name: "reply card", file: "components/patient/actions/ReplyCard.tsx" },
];

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

const words = (text: string) => text.match(/[A-Za-z][A-Za-z'-]*|\d+/g) ?? [];
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => words(s).length > 0);
}

export interface Score { grade: number; words: number; sentences: number; longest: number }
export function fleschKincaid(texts: readonly string[]): Score {
  let w = 0, s = 0, syl = 0, longest = 0;
  for (const text of texts) {
    for (const sentence of sentences(text)) {
      const ws = words(sentence);
      s += 1; w += ws.length; longest = Math.max(longest, ws.length);
      syl += ws.reduce((sum, word) => sum + (/^\d+$/.test(word) ? 1 : syllables(word)), 0);
    }
  }
  if (w === 0 || s === 0) return { grade: 0, words: 0, sentences: 0, longest: 0 };
  const grade = 0.39 * (w / s) + 11.8 * (syl / w) - 15.59;
  return { grade: Math.round(grade * 10) / 10, words: w, sentences: s, longest };
}

function collect(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") { out.push(value); return; }
  if (typeof value === "function") {
    try {
      const result = (value as (...args: unknown[]) => unknown)(...SAMPLE_ARGS.slice(0, (value as { length: number }).length));
      if (typeof result === "string") out.push(result);
    } catch { /* not a copy function */ }
    return;
  }
  if (Array.isArray(value)) { value.forEach((v) => collect(v, out, depth + 1)); return; }
  if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => collect(v, out, depth + 1));
}

function statusStrings(): string[] {
  const contact = (over: Partial<PatientContact>): PatientContact => ({ id: "c1", name: "Cleveland Clinic", channel: "email", state: "sent", consented: true, approved: true, nextFollowUpAt: "2026-10-27T16:00:00Z", lastActivityAt: null, ...over });
  const base: PatientCaseSnapshot = { caseId: "k", found: true, caseStatus: "shortlisted", diseaseName: "Ehlers-Danlos syndrome", runs: [], expectedSources: 9, shortlist: { total: 16, suggested: 3 }, contacts: [], tasks: [], applications: [], plan: { status: "approved" } };
  const snaps: PatientCaseSnapshot[] = [
    { ...base, caseStatus: "draft" },
    { ...base, caseStatus: "researching", runs: [{ agent: "trials", status: "running" }, { agent: "literature", status: "done" }] },
    base,
    { ...base, contacts: [contact({ state: "drafted", consented: false, approved: false })] },
    { ...base, plan: { status: "draft" }, contacts: [contact({ state: "drafted", approved: false })] },
    { ...base, contacts: [contact({ state: "drafted", approved: false })] },
    { ...base, contacts: [contact({})] },
    { ...base, contacts: [contact({ state: "sent", pendingFollowUp: true })] },
    { ...base, contacts: [contact({ state: "task_open", pendingReply: "records" })] },
    ...["records", "slides", "referral", "call", "redirect", "declined"].map((kind) => ({ ...base, contacts: [contact({ state: "task_open" })], tasks: [{ id: "t", contactId: "c1", kind, title: "x", status: "open" as const, dueAt: null }] })),
    { ...base, contacts: [contact({ state: "records_sent" })] },
    { ...base, contacts: [contact({ state: "stalled" })] },
    { ...base, caseStatus: "research_failed", shortlist: { total: 0, suggested: 0 } },
  ];
  return snaps.flatMap((snap) => {
    const status = patientStatus(snap, { now: new Date("2026-10-23T12:00:00Z") });
    return [status.headline, status.detail ?? "", status.nextAction?.label ?? ""].filter(Boolean);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const maxIndex = args.indexOf("--max-grade");
  const maxGrade = maxIndex >= 0 ? Number(args[maxIndex + 1]) : 8;
  let failed = false;
  const all: string[] = [];
  const results: Record<string, unknown>[] = [];
  const score = (name: string, strings: string[]) => {
    // Labels and buttons ("Continue") flatter the grade, so score only sentence-like strings (5+ words).
    const s = fleschKincaid(strings.filter((t) => words(t).length >= PROSE_MIN_WORDS));
    const banned = strings.filter((t) => words(t).some((w) => BANNED.includes(w.toLowerCase())));
    const hard = strings.filter((t) => words(t).length >= 8 && fleschKincaid([t]).grade > maxGrade);
    if (s.grade > maxGrade || banned.length > 0) failed = true;
    results.push({ source: name, strings: strings.length, ...s, banned, hardestOverMax: hard.slice(0, 5) });
  };
  for (const source of SOURCES) {
    const mod = (await import(pathToFileURL(path.resolve(source.file)).href)) as Record<string, unknown>;
    const strings: string[] = [];
    for (const [key, value] of Object.entries(mod)) if (/COPY$/.test(key)) collect(value, strings);
    if (strings.length === 0) continue;
    all.push(...strings);
    score(source.name, strings);
  }
  const statuses = statusStrings();
  all.push(...statuses);
  score("status line", statuses);
  score("ALL patient copy", all);
  if (json) console.log(JSON.stringify(results, null, 2));
  else for (const r of results) console.log(`${String(r.source).padEnd(18)} grade ${String(r.grade).padStart(4)}  strings ${String(r.strings).padStart(3)}  prose words ${String(r.words).padStart(4)}  longest sentence ${r.longest}  banned ${(r.banned as string[]).length}${(r.hardestOverMax as string[]).length ? `\n    over ${maxGrade}: ${(r.hardestOverMax as string[]).map((t) => JSON.stringify(t)).join("\n             ")}` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) void main();
