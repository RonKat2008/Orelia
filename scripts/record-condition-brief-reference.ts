// Records RAW reference/registry responses for the 3 fixture diseases (Orphadata, Exa) for offline tests.
// Run: set -a; . ./.env.local; set +a; npx tsx scripts/record-condition-brief-reference.ts
// The Exa key is sent as a header only and is never written to a fixture or the manifest.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  EXA_KINDS, EXA_SEARCH_URL, REFERENCE_FILES, exaReferenceBody, orphanetEpiUrl, orphanetNameUrl,
} from "../lib/condition-brief/sources/reference";
import { REGISTRY_FILE, registryBody } from "../lib/condition-brief/sources/registries";

const ROOT = join(process.cwd(), "fixtures", "api");
const MANIFEST = join(ROOT, "MANIFEST.json");
const EXA_API_KEY = process.env.EXA_API_KEY ?? "";
const SLEEP_MS = 400;

const DISEASES = [
  { slug: "epithelioid-sarcoma", name: "epithelioid sarcoma" },
  { slug: "vascular-eds", name: "vascular Ehlers-Danlos syndrome" },
  { slug: "igg4-related-disease", name: "IgG4-related disease" },
] as const;

interface Entry { file: string; method: string; url: string; status: number; fetched_at: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function appendManifest(entry: Entry): void {
  // Re-read right before writing: another worker appends concurrently.
  const current = JSON.parse(readFileSync(MANIFEST, "utf8")) as Entry[];
  const next = [...current.filter((e) => e.file !== entry.file), entry];
  writeFileSync(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
}

async function record(slug: string, file: string, req: { url: string; method: "GET" | "POST"; body?: unknown }) {
  const rel = `condition-brief/${slug}/${file}`;
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.method === "POST" ? { "content-type": "application/json", "x-api-key": EXA_API_KEY } : { accept: "application/json" },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  const fetchedAt = new Date().toISOString();
  if (res.ok) {
    const full = join(ROOT, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    appendManifest({ file: rel, method: req.method, url: req.url, status: res.status, fetched_at: fetchedAt });
  }
  console.log(`${res.ok ? "ok  " : "FAIL"} ${res.status} ${rel}`);
  await sleep(SLEEP_MS);
  return res.ok ? text : undefined;
}

async function main() {
  if (!EXA_API_KEY) throw new Error("EXA_API_KEY is not set");
  for (const d of DISEASES) {
    const nameBody = await record(d.slug, REFERENCE_FILES.orphanetName, { url: orphanetNameUrl(d.name), method: "GET" });
    const code = nameBody ? (JSON.parse(nameBody) as { data: { results: { ORPHAcode: number } } }).data.results.ORPHAcode : undefined;
    if (code) await record(d.slug, REFERENCE_FILES.orphanetEpi, { url: orphanetEpiUrl(code), method: "GET" });
    for (const spec of EXA_KINDS) {
      await record(d.slug, spec.file, { url: EXA_SEARCH_URL, method: "POST", body: exaReferenceBody(d.name, spec) });
    }
    await record(d.slug, REGISTRY_FILE, { url: EXA_SEARCH_URL, method: "POST", body: registryBody(d.name) });
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
