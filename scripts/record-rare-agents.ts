/**
 * Records fixtures for the rare-disease directory agents (rare_network, disease_funds, second_opinion):
 * the live Exa seed responses -> fixtures/api/exa/<case>/<fixtureKey>.json, and the live Haiku output ->
 * fixtures/llm/<agent>/<case>.json. Synthetic demo cases only. Needs EXA + Claude credentials in .env.local.
 * Run: npx tsx scripts/record-rare-agents.ts
 */
import { config as loadEnv } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

loadEnv({ path: ".env.local", quiet: true });
process.env.WAYFINDER_RECORD_LLM = "1";
delete process.env.WAYFINDER_OFFLINE;

const CASES = [
  { slug: "epithelioid-sarcoma", diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600 },
  { slug: "vascular-eds", diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300 },
  { slug: "igg4-related-disease", diseaseName: "IgG4-related disease", homeState: "NC", travelLimitMiles: 150 },
] as const;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

async function main(): Promise<void> {
  const { createLivePorts } = await import("@/lib/agents/research/live-ports");
  const { rareNetworkAgent } = await import("@/lib/agents/research/rare-network");
  const { diseaseFundsAgent } = await import("@/lib/agents/research/disease-funds");
  const { secondOpinionAgent } = await import("@/lib/agents/research/second-opinion");
  const { MemoryRunStore } = await import("@/lib/agents/run-store");
  for (const c of CASES) {
    const live = createLivePorts();
    const saved = new Set<string>();
    const directory = live.exaDirectory ?? live.exa;
    // First (seed) call per fixture key is the recording; later model-initiated calls stay live only.
    const exaDirectory = {
      async search(input: Parameters<typeof directory.search>[0]) {
        const results = await directory.search(input);
        if (input.fixtureKey && !saved.has(input.fixtureKey)) {
          saved.add(input.fixtureKey);
          const dir = path.join("fixtures", "api", "exa", c.slug);
          mkdirSync(dir, { recursive: true });
          // Hard rule: no real email addresses in fixtures.
          const scrubbed = JSON.stringify({ query: input.query, includeDomains: input.includeDomains ?? [], results }, null, 2).replace(EMAIL, "[email removed]");
          writeFileSync(path.join(dir, `${input.fixtureKey}.json`), `${scrubbed}\n`);
        }
        return results;
      },
    };
    const ports = { ...live, exaDirectory };
    const out = await Promise.all(
      [rareNetworkAgent, diseaseFundsAgent, secondOpinionAgent].map(async (agent) => {
        const started = Date.now();
        const r = await agent.run({ diseaseName: c.diseaseName, homeState: c.homeState, travelLimitMiles: c.travelLimitMiles, goals: ["second_opinion", "aid"] }, { ports, store: new MemoryRunStore(), caseId: `record-${c.slug}` });
        return `${agent.name}: ${r.status === "ok" ? `${r.records.length} records` : r.status === "error" ? `error ${r.message}` : r.status} in ${Date.now() - started}ms`;
      }),
    );
    console.log(c.slug, out.join(" | "));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
