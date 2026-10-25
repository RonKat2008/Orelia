/**
 * Live end-to-end on synthetic fixtures only.
 * Run: npx tsx scripts/live-run.ts --case <slug>|--all [--out <file>]
 * Forces the Neon AI Gateway when NEON_AI_GATEWAY_* is set, records fixtures/llm,
 * and never loads AgentMail/AgentCall keys.
 */
import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SLUGS = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;

const ROLE_MARKERS: [string, string][] = [
  ["Intake extractor", "intake-extractor"],
  ["Literature agent", "literature"],
  ["Trials agent", "trials"],
  ["Identity agent", "identity"],
  ["Centers agent", "centers"],
  ["Advocacy agent", "advocacy"],
  ["Aid agent", "aid"],
  ["Research network agent", "rare_network"],
  ["Disease fund agent", "disease_funds"],
  ["Expert center agent", "second_opinion"],
];

/** Published list rates, USD per million tokens. Opus 5.5 has no confirmed public list price; 15/75 is the Opus 4.1 stand-in. */
export const RATE_CARD: Record<string, { input: number; output: number; priced: boolean; note: string }> = {
  "claude-haiku-4-5": { input: 1, output: 5, priced: true, note: "Anthropic Haiku 4.5 list price" },
  "claude-haiku-5-5": { input: 1, output: 5, priced: false, note: "Haiku 4.5 stand-in; Haiku 5.5 list price not confirmed" },
  "claude-opus-5-5": { input: 15, output: 75, priced: false, note: "Opus 4.1 stand-in; Opus 5.5 list price not confirmed" },
};

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function agentFromSystem(system: unknown): string {
  const text = typeof system === "string" ? system : JSON.stringify(system ?? "");
  for (const [marker, name] of ROLE_MARKERS) if (text.includes(marker)) return name;
  return "unknown";
}

export function parseUsage(body: unknown): TokenUsage | undefined {
  if (!body || typeof body !== "object" || !("usage" in body)) return undefined;
  const usage = (body as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const num = (k: string) => (typeof usage[k] === "number" ? (usage[k] as number) : 0);
  return { input: num("input_tokens"), output: num("output_tokens"), cacheWrite: num("cache_creation_input_tokens"), cacheRead: num("cache_read_input_tokens") };
}

export function estimateUsd(model: string, usage: TokenUsage): { usd: number; priced: boolean; note: string } {
  const rate = RATE_CARD[model] ?? { input: 0, output: 0, priced: false, note: `no rate for ${model}` };
  const usd =
    ((usage.input + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1) * rate.input + usage.output * rate.output) /
    1_000_000;
  return { usd, priced: rate.priced, note: rate.note };
}

export interface DriftNote {
  host: string;
  path: string;
  status: number;
  detail: string;
}

export function classifyApiBody(url: URL, status: number, body: unknown, contentType: string): DriftNote | undefined {
  const host = url.host;
  const snippet = (v: unknown) => JSON.stringify(v).slice(0, 240);
  if (status < 200 || status >= 300) {
    return { host, path: url.pathname, status, detail: `HTTP ${status} ${contentType} ${snippet(body)}` };
  }
  if (host.includes("ncbi.nlm.nih.gov")) {
    const obj = body as { error?: unknown; esearchresult?: { ERROR?: string }; epostresult?: { ERROR?: string } } | null;
    const err = obj && typeof obj === "object" ? obj.error ?? obj.esearchresult?.ERROR ?? obj.epostresult?.ERROR : undefined;
    if (err) return { host, path: url.pathname, status, detail: `NCBI error field: ${snippet(err)}` };
    if (url.pathname.endsWith("esearch.fcgi") && obj && typeof obj === "object" && !("esearchresult" in obj)) {
      return { host, path: url.pathname, status, detail: "esearch JSON missing esearchresult" };
    }
  }
  if (host.includes("clinicaltrials.gov")) {
    const obj = body as { studies?: unknown; error?: unknown } | null;
    if (obj && typeof obj === "object" && obj.error) return { host, path: url.pathname, status, detail: `CT.gov error: ${snippet(obj.error)}` };
    if (obj && typeof obj === "object" && !("studies" in obj) && !("nextPageToken" in obj)) {
      return { host, path: url.pathname, status, detail: "CT.gov JSON missing studies" };
    }
  }
  if (host.includes("npiregistry.cms.hhs.gov")) {
    const obj = body as { Errors?: unknown; results?: unknown } | null;
    if (obj && typeof obj === "object" && obj.Errors) return { host, path: url.pathname, status, detail: `NPPES Errors: ${snippet(obj.Errors)}` };
    if (obj && typeof obj === "object" && !("results" in obj)) return { host, path: url.pathname, status, detail: "NPPES JSON missing results" };
  }
  if (host.includes("api.exa.ai")) {
    const obj = body as { error?: unknown; results?: unknown } | null;
    if (obj && typeof obj === "object" && obj.error) return { host, path: url.pathname, status, detail: `Exa error: ${snippet(obj.error)}` };
    if (obj && typeof obj === "object" && !("results" in obj)) return { host, path: url.pathname, status, detail: "Exa JSON missing results" };
  }
  if (host.includes("anthropic") || url.pathname.includes("/anthropic")) {
    const obj = body as { type?: string; error?: { message?: string } } | null;
    if (obj && typeof obj === "object" && obj.type === "error") {
      return { host, path: url.pathname, status, detail: `gateway/anthropic error: ${obj.error?.message ?? snippet(obj)}` };
    }
  }
  return undefined;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function prepareEnv(): void {
  loadEnv({ path: path.join(process.cwd(), ".env.local"), override: true });
  delete process.env.WAYFINDER_OFFLINE;
  for (const key of ["AGENTMAIL_API_KEY", "AGENTCALL_API_KEY", "AGENTMAIL_WEBHOOK_SECRET", "AGENTCALL_WEBHOOK_SECRET", "AGENTCALL_FROM_NUMBER_ID"]) {
    delete process.env[key];
  }
  if (process.argv.includes("--record")) process.env.WAYFINDER_RECORD_LLM = "1";
  else delete process.env.WAYFINDER_RECORD_LLM;
  if (process.env.OUTBOUND_ALLOWLIST && !process.env.OUTBOUND_ALLOWLIST.includes(".example")) {
    delete process.env.OUTBOUND_ALLOWLIST;
  }
}

export interface LedgerRow {
  agent: string;
  model: string;
  calls: number;
  usage: TokenUsage;
}

export function tally(events: { agent: string; model: string; usage: TokenUsage }[]): LedgerRow[] {
  const map = new Map<string, LedgerRow>();
  for (const e of events) {
    const key = `${e.agent}\t${e.model}`;
    const row = map.get(key) ?? { agent: e.agent, model: e.model, calls: 0, usage: emptyUsage() };
    row.calls += 1;
    row.usage = addUsage(row.usage, e.usage);
    map.set(key, row);
  }
  return [...map.values()];
}

let activeEvents: { agent: string; model: string; usage: TokenUsage }[] | undefined;
let activeDrift: DriftNote[] | undefined;
let fetchTapped = false;

function installTap(events: { agent: string; model: string; usage: TokenUsage }[], drift: DriftNote[]): void {
  activeEvents = events;
  activeDrift = drift;
  if (fetchTapped) return;
  fetchTapped = true;
  const orig = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const res = await orig(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const watched =
      url.host.includes("ncbi") ||
      url.host.includes("clinicaltrials.gov") ||
      url.host.includes("cms.hhs.gov") ||
      url.host.includes("exa.ai") ||
      url.pathname.includes("/anthropic") ||
      url.host.includes("anthropic");
    if (!watched) return res;
    const contentType = res.headers.get("content-type") ?? "";
    let parsed: unknown = undefined;
    try {
      parsed = JSON.parse(await res.clone().text());
    } catch {
      if (res.status < 200 || res.status >= 300) activeDrift?.push({ host: url.host, path: url.pathname, status: res.status, detail: `non-JSON ${contentType}` });
      return res;
    }
    const note = classifyApiBody(url, res.status, parsed, contentType);
    if (note) activeDrift?.push(note);
    const usage = parseUsage(parsed);
    if (usage) {
      let model = "unknown";
      let system: unknown = "";
      try {
        const req = JSON.parse(String(init?.body ?? "{}")) as { model?: string; system?: unknown };
        model = req.model ?? "unknown";
        system = req.system;
      } catch {
        /* ignore */
      }
      activeEvents?.push({ agent: agentFromSystem(system), model, usage });
    }
    return res;
  };
}

async function runCase(slug: string) {
  const { readFile } = await import("node:fs/promises");
  const { extractCase } = await import("@/lib/agents/intake-extractor");
  const { runResearch } = await import("@/lib/agents/orchestrator");
  const { MemoryCaseStore } = await import("@/lib/agents/case-store");
  const { MemoryPersist } = await import("@/lib/agents/persist");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  const { researchAgents } = await import("@/lib/agents/research");
  const { createLivePorts } = await import("@/lib/agents/research/live-ports");
  const { modelFor } = await import("@/config/models");
  const { gatewayConfig } = await import("@/lib/ai/gateway");

  const report = await readFile(`fixtures/reports/${slug}.md`, "utf8");
  const cases = new MemoryCaseStore();
  const store = new MemoryRunStore();
  const persist = new MemoryPersist();
  const events: { agent: string; model: string; usage: TokenUsage }[] = [];
  const drift: DriftNote[] = [];
  installTap(events, drift);

  const tExtract = Date.now();
  const input = await extractCase(report, { offlineKey: slug, store });
  const extractMs = Date.now() - tExtract;

  const created = await cases.create(input, "draft");
  await cases.update(created.id, input, "confirmed");

  const tResearch = Date.now();
  let researchError: string | undefined;
  let summary: Awaited<ReturnType<typeof runResearch>> | undefined;
  try {
    summary = await runResearch(created.id, {
      store,
      persist,
      cases,
      ports: createLivePorts(),
      agents: researchAgents,
    });
  } catch (e) {
    researchError = e instanceof Error ? e.message : String(e);
  }
  const researchMs = Date.now() - tResearch;

  const runs = await store.listByCase(created.id);
  const shortlist = summary ? await persist.getShortlist(created.id) : [];
  const byKind: Record<string, number> = {};
  for (const item of shortlist) byKind[item.targetKind] = (byKind[item.targetKind] ?? 0) + 1;

  const agentTimes = runs.map((r) => ({
    agent: r.agent,
    status: r.status,
    ms: r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    summary: r.outputSummary,
    error: r.error,
  }));
  const started = agentTimes.flatMap((a) => (a.ms == null ? [] : [a]));
  const swarmMs = started.length
    ? Math.max(...runs.flatMap((r) => (r.finishedAt ? [r.finishedAt.getTime()] : []))) -
      Math.min(...runs.flatMap((r) => (r.startedAt ? [r.startedAt.getTime()] : [])))
    : null;

  const ledger = tally(events);
  const cost = ledger.map((row) => ({ ...row, ...estimateUsd(row.model, row.usage) }));
  const totalUsd = cost.reduce((s, r) => s + r.usd, 0);

  return {
    slug,
    disease: input.diseaseName,
    gateway: Boolean(gatewayConfig()),
    models: { intake: modelFor("intake"), research: modelFor("research"), verifier: modelFor("verifier") },
    timingsMs: { extract: extractMs, researchVerifyRank: researchMs, swarmWall: swarmMs, tailAfterAgents: swarmMs == null ? null : researchMs - swarmMs },
    agents: agentTimes,
    verify: summary?.verify ?? null,
    dropped: (summary?.verified.dropped ?? []).slice(0, 20).map((d) => {
      const r = d.record as { kind?: string; nctId?: string; name?: string; title?: string };
      return { type: d.type, reason: d.reason, label: r.nctId ?? r.name ?? r.title ?? r.kind ?? "" };
    }),
    researchError,
    shortlistByKind: byKind,
    shortlistSize: shortlist.length,
    experts: (summary?.verified.kept ?? []).flatMap((rec) =>
      rec.resource.kind === "expert"
        ? [{ name: rec.resource.name, npi: rec.resource.npi ?? null, verified: rec.resource.verified ?? false, eligible: rec.shortlistEligibility?.eligible ?? false }]
        : [],
    ),
    curator: summary?.curation ?? null,
    ledger: cost,
    totalUsd,
    drift,
  };
}

async function main() {
  prepareEnv();
  const slugs = process.argv.includes("--all") ? [...SLUGS] : [arg("--case") ?? SLUGS[0]];
  const out = arg("--out");
  const reports = [];
  for (const slug of slugs) {
    console.error(`\n===== live ${slug} =====`);
    const report = await runCase(slug);
    reports.push(report);
    console.error(JSON.stringify({ slug, timingsMs: report.timingsMs, totalUsd: report.totalUsd, shortlist: report.shortlistByKind, failed: report.agents.filter((a) => a.status === "failed").map((a) => a.agent) }, null, 2));
  }
  const json = JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2);
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, json);
  }
  console.log(json);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
