/**
 * Offline end-to-end: report -> extract -> research (9 agents) -> verify -> rank -> shortlist.
 * Run: WAYFINDER_OFFLINE=1 npx tsx scripts/demo-offline.ts   (npm run demo:offline)
 */
process.env.WAYFINDER_OFFLINE = "1";

const MAX_MS = 180_000;

async function main() {
  const { readFile } = await import("node:fs/promises");
  const { extractCase } = await import("@/lib/agents/intake-extractor");
  const { runResearch } = await import("@/lib/agents/orchestrator");
  const { MemoryCaseStore } = await import("@/lib/agents/case-store");
  const { MemoryPersist } = await import("@/lib/agents/persist");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  const { placeholderRank } = await import("@/lib/agents/placeholder-rank");
  const { researchAgents } = await import("@/lib/agents/research");
  const { createFixturePorts } = await import("@/lib/agents/research/fixture-ports");

  const started = Date.now();
  const report = await readFile("fixtures/reports/epithelioid-sarcoma.md", "utf8");
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
    rank: placeholderRank, // swap for lib/ranking/rank.ts when task #4 merges
    ports: createFixturePorts(),
    agents: researchAgents,
  });

  console.log("\nAgent runs:");
  for (const run of await store.listByCase(created.id)) {
    console.log(`  ${run.agent.padEnd(15)} ${run.status.padEnd(16)} ${run.outputSummary ?? run.error ?? ""}`);
  }
  console.log(`\nVerifier: ${JSON.stringify(summary.verify)}`);

  const shortlist = await persist.getShortlist(created.id);
  const failures: string[] = [];
  console.log("\nShortlist:");
  for (const item of shortlist) {
    console.log(`  [${item.targetKind}] #${item.rank} ${item.name}  score=${item.score}`);
    if (item.evidence.length === 0) failures.push(`${item.name}: no evidence`);
    for (const e of item.evidence) {
      console.log(`      - ${e.claim}  <${e.sourceUrl}>`);
      if (!e.sourceUrl || !/^https?:\/\//.test(e.sourceUrl)) failures.push(`${item.name}: claim without sourceUrl: ${e.claim}`);
    }
    for (const b of item.breakdown) {
      for (const id of b.evidenceIds) {
        if (!item.evidence.some((e) => e.id === id)) failures.push(`${item.name}: breakdown cites unknown evidence ${id}`);
      }
    }
  }

  const elapsed = Date.now() - started;
  console.log(`\nElapsed: ${(elapsed / 1000).toFixed(1)}s`);
  if (shortlist.length === 0) failures.push("empty shortlist");
  if (elapsed > MAX_MS) failures.push(`took ${elapsed}ms (> ${MAX_MS}ms)`);
  if (failures.length) {
    console.error(`\nFAILED:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("OK: every shortlisted claim has a sourceUrl.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
