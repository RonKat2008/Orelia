/**
 * Offline end-to-end: report -> extract -> research (9 agents) -> verify -> rank -> shortlist.
 * Run: WAYFINDER_OFFLINE=1 npx tsx scripts/demo-offline.ts [--case <slug>|--all] [--top <n>]  (npm run demo:offline)
 * Cases: epithelioid-sarcoma (default), vascular-eds, igg4-related-disease. --top limits the printed shortlist per kind.
 */
process.env.WAYFINDER_OFFLINE = "1";

const MAX_MS = 180_000;
const SLUGS = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runCase(slug: string, top: number): Promise<string[]> {
  const { readFile } = await import("node:fs/promises");
  const { extractCase } = await import("@/lib/agents/intake-extractor");
  const { runResearch } = await import("@/lib/agents/orchestrator");
  const { MemoryCaseStore } = await import("@/lib/agents/case-store");
  const { MemoryPersist } = await import("@/lib/agents/persist");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  const { researchAgents } = await import("@/lib/agents/research");
  const { createFixturePorts } = await import("@/lib/agents/research/fixture-ports");

  const started = Date.now();
  const report = await readFile(`fixtures/reports/${slug}.md`, "utf8");
  const cases = new MemoryCaseStore();
  const store = new MemoryRunStore();
  const persist = new MemoryPersist();

  const input = await extractCase(report);
  const created = await cases.create(input, "draft");
  await cases.update(created.id, input, "confirmed");
  console.log(`Case: ${input.diseaseName} (${input.homeCity}, ${input.homeState})`);

  const summary = await runResearch(created.id, {
    store,
    persist,
    cases,
    ports: createFixturePorts(),
    agents: researchAgents,
  });

  console.log("\nAgent runs:");
  for (const run of await store.listByCase(created.id)) {
    console.log(`  ${run.agent.padEnd(15)} ${run.status.padEnd(16)} ${run.outputSummary ?? run.error ?? ""}`);
  }
  console.log(`\nVerifier: ${JSON.stringify(summary.verify)}`);
  for (const d of summary.verified.dropped) {
    const r = d.record as { kind?: string; nctId?: string; title?: string; name?: string };
    console.log(`  dropped ${d.type} ${r.nctId ?? r.name ?? ""} ${(r.title ?? "").slice(0, 60)} -- ${d.reason}`);
  }

  const shortlist = await persist.getShortlist(created.id);
  const failures: string[] = [];
  console.log("\nShortlist:");
  for (const item of shortlist) {
    const shown = item.rank <= top;
    if (shown) console.log(`  [${item.targetKind}] #${item.rank} ${item.name}  score=${item.score}`);
    if (item.evidence.length === 0) failures.push(`${item.name}: no evidence`);
    for (const e of item.evidence) {
      if (shown) console.log(`      - ${e.claim}  <${e.sourceUrl}>`);
      if (!e.sourceUrl || !/^https?:\/\//.test(e.sourceUrl)) failures.push(`${item.name}: claim without sourceUrl: ${e.claim}`);
    }
    for (const b of item.breakdown) {
      if (shown && b.points > 0) console.log(`      ~ ${b.factor} +${b.points}: ${b.text}`);
      for (const id of b.evidenceIds) {
        if (!item.evidence.some((e) => e.id === id)) failures.push(`${item.name}: breakdown cites unknown evidence ${id}`);
      }
    }
  }

  const elapsed = Date.now() - started;
  console.log(`\nElapsed: ${(elapsed / 1000).toFixed(1)}s`);
  if (shortlist.length === 0) failures.push("empty shortlist");
  if (elapsed > MAX_MS) failures.push(`took ${elapsed}ms (> ${MAX_MS}ms)`);
  return failures;
}

async function main() {
  const top = Number(arg("--top") ?? "100");
  const slugs = process.argv.includes("--all") ? SLUGS : [arg("--case") ?? SLUGS[0]];
  const failures: string[] = [];
  for (const slug of slugs) {
    console.log(`\n===== ${slug} =====`);
    failures.push(...(await runCase(slug, top)).map((f) => `${slug}: ${f}`));
  }
  if (failures.length) {
    console.error(`\nFAILED:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\nOK: every shortlisted claim has a sourceUrl.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
