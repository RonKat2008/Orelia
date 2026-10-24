/**
 * Needs analyst + final judge: fixture recording and the curator-vs-judge eval on the three synthetic demo cases.
 *   WAYFINDER_OFFLINE=1 npx tsx scripts/needs-judge-eval.ts --dump <dir>    offline pipeline -> <dir>/<slug>.json (ranked + sources)
 *   npx tsx scripts/needs-judge-eval.ts --record <dir>                      live needs + judge on the dumped inputs; writes fixtures/llm/{needs,judge}
 *   npx tsx scripts/needs-judge-eval.ts --record <dir> --judge-only       replay needs from fixtures; live judge only
 *   WAYFINDER_OFFLINE=1 npx tsx scripts/needs-judge-eval.ts --eval <dir>    old curator picks vs new judge verdicts -> markdown on stdout
 * Live mode needs model credentials in the environment (set -a; . ./.env.local; set +a).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SLUGS = ["vascular-eds", "epithelioid-sarcoma", "igg4-related-disease"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function dump(dir: string) {
  const { extractCase } = await import("@/lib/agents/intake-extractor");
  const { runResearch } = await import("@/lib/agents/orchestrator");
  const { MemoryCaseStore } = await import("@/lib/agents/case-store");
  const { MemoryPersist } = await import("@/lib/agents/persist");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  const { researchAgents } = await import("@/lib/agents/research");
  const { createFixturePorts } = await import("@/lib/agents/research/fixture-ports");
  const { collectNeedsSources } = await import("@/lib/agents/needs/sources");
  const { FixtureTransport } = await import("@/lib/sources/transport");
  await mkdir(dir, { recursive: true });
  for (const slug of SLUGS) {
    const input = await extractCase(await readFile(`fixtures/reports/${slug}.md`, "utf8"));
    const cases = new MemoryCaseStore();
    const created = await cases.create(input, "confirmed");
    let ranked: unknown = [];
    await runResearch(created.id, {
      store: new MemoryRunStore(), persist: new MemoryPersist(), cases, ports: createFixturePorts(), agents: researchAgents,
      needs: async () => undefined,
      judge: async (_id, _c, r) => {
        ranked = r;
        return { tiers: [], summary: "", suggested: [], dropped: [], source: "fallback" };
      },
    });
    const collected = await collectNeedsSources(input.diseaseName, { transport: new FixtureTransport(), offline: true, fixtureSlug: slug, now: new Date() });
    await writeFile(path.join(dir, `${slug}.json`), JSON.stringify({ caseRecord: input, ranked, sources: collected.sources }, null, 1));
    console.log(`${slug}: ${(ranked as unknown[]).length} ranked, ${collected.sources.length} sources`);
  }
}

async function record(dir: string) {
  process.env.WAYFINDER_RECORD_LLM = "1";
  const { runNeedsAnalyst, MemoryNeedsStore } = await import("@/lib/agents/needs");
  const { runJudge } = await import("@/lib/agents/judge");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  for (const slug of SLUGS) {
    const { caseRecord, ranked, sources } = JSON.parse(await readFile(path.join(dir, `${slug}.json`), "utf8"));
    const store = new MemoryRunStore();
    const t0 = Date.now();
    const judgeOnly = process.argv.includes("--judge-only");
    if (judgeOnly) process.env.WAYFINDER_OFFLINE = "1";
    const needs = await runNeedsAnalyst("eval", caseRecord, { store, offline: judgeOnly, needsStore: new MemoryNeedsStore(), collect: async () => ({ diseaseName: caseRecord.diseaseName, sources, prevalence: [], studies: [], research: [], registries: [], errors: [] }) });
    if (judgeOnly) delete process.env.WAYFINDER_OFFLINE;
    const t1 = Date.now();
    const { result } = await runJudge("eval", caseRecord, ranked, needs, { store, offlineKey: slug });
    const runs = await store.listByCase("eval");
    console.log(`${slug}: needs ${needs ? "ok" : "FAILED"} in ${t1 - t0}ms (${runs.find((r) => r.agent === "needs")?.outputSummary ?? runs.find((r) => r.agent === "needs")?.error}); judge ${result.source} in ${Date.now() - t1}ms, keep ${result.counts.keep} maybe ${result.counts.maybe} drop ${result.counts.drop}`);
  }
}

async function evaluate(dir: string) {
  const { loadFixture } = await import("@/lib/agents/replay");
  const { curationSchema } = await import("@/lib/contracts");
  const { validateCuration } = await import("@/lib/agents/curator");
  const { runNeedsAnalyst, MemoryNeedsStore } = await import("@/lib/agents/needs");
  const { runJudge } = await import("@/lib/agents/judge");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  const lines: string[] = [];
  for (const slug of SLUGS) {
    const { caseRecord, ranked, sources } = JSON.parse(await readFile(path.join(dir, `${slug}.json`), "utf8"));
    const curator = validateCuration(await loadFixture("curator", slug, curationSchema), ranked);
    const store = new MemoryRunStore();
    const needs = await runNeedsAnalyst("eval", caseRecord, { store, offline: true, needsStore: new MemoryNeedsStore(), collect: async () => ({ diseaseName: caseRecord.diseaseName, sources, prevalence: [], studies: [], research: [], registries: [], errors: [] }) });
    const { result, curation } = await runJudge("eval", caseRecord, ranked, needs, { store, offlineKey: slug });
    const curTier = new Map(curator.tiers.map((t) => [t.candidateId, t.tier]));
    let changed = 0;
    const rows: string[] = [];
    for (const j of result.judgements) {
      const before = curTier.get(j.candidateId) ?? "-";
      const diff = before !== j.tier;
      if (diff) changed++;
      rows.push(`| ${j.kind} | ${j.name.slice(0, 48)} | ${j.score} | ${before} | ${j.verdict} / ${j.tier} | ${diff ? "**changed**" : ""} | ${j.reason.replace(/\|/g, "/").slice(0, 160)} |`);
    }
    const sugBefore = curator.suggested.length;
    lines.push(
      `### ${slug} (${caseRecord.diseaseName})`,
      "",
      `Needs: ${needs ? `${needs.specialties.length} specialties, ${needs.centerCapabilities.length} capabilities, ${needs.redFlags.length} red flags, ${needs.trialEligibility.length} trial checks, ${needs.supportNeeds.length} support, ${needs.questions.length} questions, ${needs.sources.length} sources, ${needs.dropped.length} dropped by code` : "none"}.`,
      `Judge: keep ${result.counts.keep}, maybe ${result.counts.maybe}, drop ${result.counts.drop}; ${changed}/${result.judgements.length} tiers changed vs curator; suggested ${sugBefore} -> ${curation.suggested.length}; rejected ${result.rejected.length}.`,
      "",
      "| kind | candidate | score | curator tier | judge verdict / tier | | judge reason |",
      "|---|---|---|---|---|---|---|",
      ...rows,
      "",
    );
  }
  console.log(lines.join("\n"));
}

async function main() {
  const dir = arg("--dump") ?? arg("--record") ?? arg("--eval");
  if (!dir) throw new Error("usage: --dump|--record|--eval <dir>");
  if (process.argv.includes("--dump")) await dump(dir);
  else if (process.argv.includes("--record")) await record(dir);
  else await evaluate(dir);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.stack : e).replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]"));
  process.exit(1);
});
