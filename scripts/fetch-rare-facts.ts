/**
 * Fetches the rare-disease facts shown on /about through the repo's Exa wrapper and stores, for each fact, the
 * source URL, title, fetch time and the EXACT sentence it relies on. Run by hand, review the diff, commit the JSON:
 *   npx tsx scripts/fetch-rare-facts.ts [path-to-env-file]
 * Keys are read from the env file (default ./.env.local) and never printed.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ExaClient, type ExaPage } from "../lib/sources/exa";
import { FetchTransport } from "../lib/sources/transport";

export interface FactSpec {
  id: string;
  /** Plain-words line shown above the quote. Any number in it must appear in the excerpt. */
  claim: string;
  query: string;
  /** Hostnames (suffix match) a source page must come from. */
  hosts: readonly string[];
  /** A sentence qualifies only if it matches every pattern. */
  patterns: readonly RegExp[];
}

export const FACT_SPECS: readonly FactSpec[] = [
  {
    id: "condition-count",
    claim: "Experts estimate that more than 10,000 rare diseases exist.",
    query: "how many rare diseases are there approximately 7,000 NORD NIH GARD",
    hosts: ["rarediseases.org", "rarediseases.info.nih.gov", "ncats.nih.gov", "eurordis.org"],
    patterns: [/\b\d{1,2},\d{3}\b/, /rare (diseases|conditions|disorders)/i],
  },
  {
    id: "time-to-diagnosis",
    claim: "Getting a diagnosis can take nearly five years.",
    query: "average time to diagnosis rare disease years NORD EURORDIS diagnostic odyssey",
    hosts: ["rarediseases.org", "rarediseases.info.nih.gov", "ncats.nih.gov", "eurordis.org"],
    patterns: [/\b(\d+(\.\d+)?|four|five|six|seven)\b[^.]{0,40}years/i, /diagnos/i],
  },
];

const MAX_SENTENCE = 400;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length <= MAX_SENTENCE);
}

export function pickSentence(spec: FactSpec, page: ExaPage): string | undefined {
  return splitSentences(page.text ?? "").find((s) => spec.patterns.every((p) => p.test(s)));
}

function hostAllowed(url: string, hosts: readonly string[]): boolean {
  const host = new URL(url).hostname;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

async function main(): Promise<void> {
  const envFile = path.resolve(process.argv[2] ?? ".env.local");
  if (existsSync(envFile)) dotenv.config({ path: envFile });
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  const exa = new ExaClient(new FetchTransport(), key);
  const facts = [];
  for (const spec of FACT_SPECS) {
    const { records, evidence } = await exa.search(spec.query, { numResults: 15 });
    const fetchedAt = evidence[0]?.fetchedAt ?? new Date().toISOString();
    let found: { page: ExaPage; excerpt: string } | undefined;
    for (const page of records.filter((p) => hostAllowed(p.url, spec.hosts))) {
      const excerpt = pickSentence(spec, page);
      if (excerpt) { found = { page, excerpt }; break; }
    }
    if (!found) { console.error(`No qualifying sentence for ${spec.id}; fact omitted.`); continue; }
    facts.push({ id: spec.id, claim: spec.claim, url: found.page.url, title: found.page.title ?? new URL(found.page.url).hostname, fetchedAt, excerpt: found.excerpt });
    console.log(`${spec.id}: ${found.page.url}\n  "${found.excerpt}"`);
  }
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/rare-disease-facts.json");
  writeFileSync(out, `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(`Wrote ${facts.length} facts to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "fetch failed"); process.exit(1); });
}
