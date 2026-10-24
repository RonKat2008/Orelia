// Records RAW PubMed / ClinicalTrials.gov / NIH RePORTER responses for the Condition Brief studies + research
// collectors under fixtures/api/condition-brief/<slug>/ and appends MANIFEST.json entries.
// Run: set -a; . ./.env.local; set +a; npx tsx scripts/record-condition-brief-studies.ts
//
// The collectors themselves run against a recording transport, so each recorded URL is exactly what the live
// collector requests. NCBI api keys are deliberately NOT passed to the collectors: they never reach a fixture.
// `now` is fixed so the date-dependent queries (PubMed mindate/maxdate, RePORTER fiscal years) are reproducible.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FetchTransport } from "../lib/sources/transport";
import type { SourceRequest, SourceResponse, Transport } from "../lib/sources/transport";
import { collectResearch } from "../lib/condition-brief/sources/research";
import { collectStudies } from "../lib/condition-brief/sources/studies";
import type { CollectContext } from "../lib/condition-brief/sources/types";

/** Fixed clock: all fixtures were recorded for this date (ctx.now in the offline tests must match). */
export const RECORDING_NOW = new Date("2026-10-24T12:00:00.000Z");
const API_DIR = join(process.cwd(), "fixtures", "api");
const MANIFEST = join(API_DIR, "MANIFEST.json");

const DISEASES = [
  { slug: "epithelioid-sarcoma", name: "Epithelioid sarcoma" },
  { slug: "vascular-eds", name: "Vascular Ehlers-Danlos syndrome" },
  { slug: "igg4-related-disease", name: "IgG4-related disease" },
];

type Entry = { file: string; method: string; url: string; status: number; fetched_at: string };

function appendManifest(entry: Entry): void {
  // Re-read immediately before writing: another worker appends concurrently. Synchronous, so no interleaving here.
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Entry[];
  const next = [...manifest.filter((e) => e.file !== entry.file), entry];
  writeFileSync(MANIFEST, JSON.stringify(next, null, 2) + "\n");
}

class RecordingTransport implements Transport {
  private live = new FetchTransport();
  async request(req: SourceRequest): Promise<SourceResponse> {
    if (!req.key) throw new Error("recording requires a fixture key");
    const res = await this.live.request({ ...req, key: undefined });
    const path = join(API_DIR, req.key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, res.body);
    appendManifest({ file: req.key, method: req.method ?? "GET", url: req.url, status: res.status, fetched_at: res.fetchedAt });
    console.log(`recorded ${req.key} (${res.body.length} bytes)`);
    return res;
  }
}

async function main(): Promise<void> {
  for (const d of DISEASES) {
    const ctx: CollectContext = { transport: new RecordingTransport(), offline: true, fixtureSlug: d.slug, now: RECORDING_NOW };
    const studies = await collectStudies(d.name, ctx);
    const research = await collectResearch(d.name, ctx);
    console.log(d.slug, {
      studies: studies.studies?.length, research: research.research?.length,
      errors: [...(studies.errors ?? []), ...(research.errors ?? [])],
    });
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
