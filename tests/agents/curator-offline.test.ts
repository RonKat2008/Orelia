import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { isReachable } from "@/lib/outreach/reachability";
import { fallbackCuration, validateCuration } from "@/lib/agents/curator";
import { MemoryCurationStore } from "@/lib/agents/curator-store";
import { extractCase } from "@/lib/agents/intake-extractor";
import { runResearch } from "@/lib/agents/orchestrator";
import { MemoryPersist } from "@/lib/agents/persist";
import { researchAgents } from "@/lib/agents/research";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { curationSchema } from "@/lib/contracts";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";

const SLUGS = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;

async function run(slug: string, withCurator: boolean) {
  const input = await extractCase(readFileSync(`fixtures/reports/${slug}.md`, "utf8"));
  const cases = new MemoryCaseStore();
  const created = await cases.create(input, "draft");
  await cases.update(created.id, input, "confirmed");
  const persist = new MemoryPersist();
  const summary = await runResearch(created.id, {
    store: new MemoryRunStore(),
    persist,
    cases,
    ports: createFixturePorts(),
    agents: researchAgents,
    curations: new MemoryCurationStore(),
    ...(withCurator ? {} : { curate: async (_id, _c, ranked) => fallbackCuration(ranked, "curate phase disabled") }),
  });
  return { summary, ranked: summary.ranked };
}

describe("curator offline fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const slug of SLUGS) {
    describe(slug, () => {
      it("fixture parses with curationSchema and has no medical-advice language", () => {
        const raw = JSON.parse(readFileSync(`fixtures/llm/curator/${slug}.json`, "utf8"));
        const cur = curationSchema.parse(raw);
        expect(flagMedicalAdvice(cur.summary).flagged).toBe(false);
        for (const p of cur.picks) for (const r of p.reasons) expect(flagMedicalAdvice(r.text).flagged).toBe(false);
      });

      it("replays cleanly through the full offline pipeline", async () => {
        const { summary, ranked } = await run(slug, true);
        expect(summary.curation.source).toBe("model");
        expect(ranked.length).toBeGreaterThan(0);

        // The fixture itself is clean: validateCuration drops nothing from it.
        const fixture = curationSchema.parse(JSON.parse(readFileSync(`fixtures/llm/curator/${slug}.json`, "utf8")));
        const validated = validateCuration(fixture, ranked);
        expect(validated.dropped).toEqual([]);
        expect(validated.source).toBe("model");

        const ids = ranked.map((r) => r.record.resource.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(fixture.picks.map((p) => p.candidateId)).size).toBe(fixture.picks.length);
        expect(validated.tiers.map((t) => t.candidateId).sort()).toEqual([...ids].sort());
        expect(validated.tiers.every((t) => ["best", "good", "backup", "exclude"].includes(t.tier))).toBe(true);

        const bestByKind = new Map<string, number>();
        for (const t of validated.tiers) if (t.tier === "best") bestByKind.set(t.kind, (bestByKind.get(t.kind) ?? 0) + 1);
        for (const n of bestByKind.values()) expect(n).toBeLessThanOrEqual(2);

        const evidence = new Map(ranked.map((r) => [r.record.resource.id, new Set(r.record.evidence.map((e) => e.id))]));
        for (const t of validated.tiers) {
          for (const reason of t.reasons) {
            expect(reason.evidenceIds.length).toBeGreaterThan(0);
            for (const id of reason.evidenceIds) expect(evidence.get(t.candidateId)?.has(id)).toBe(true);
            expect(flagMedicalAdvice(reason.text).flagged).toBe(false);
          }
          if (t.tier === "best") expect(t.reasons.length).toBeGreaterThan(0);
        }
        expect(flagMedicalAdvice(validated.summary).flagged).toBe(false);
        expect(validated.summary.length).toBeGreaterThan(0);

        expect(summary.curation.suggested.length).toBeLessThanOrEqual(5);
        // Pre-selection requires a contact route: exactly the reachable best picks, nothing doorless.
        const reachableIds = new Set(ranked.filter((r) => isReachable(r.record.evidence)).map((r) => r.record.resource.id));
        for (const id of summary.curation.suggested) expect(reachableIds.has(id)).toBe(true);
        const tierOf = new Map(validated.tiers.map((t) => [t.candidateId, t.tier]));
        for (const id of summary.curation.suggested) expect(tierOf.get(id)).toBe("best");
        expect(summary.curation.suggested).toEqual(validated.suggested);
      });

      it("does not change ranks or scores", async () => {
        const withCurator = await run(slug, true);
        const without = await run(slug, false);
        const shape = (r: { ranked: typeof withCurator.ranked }) =>
          r.ranked.map((e) => ({ id: e.record.resource.id, rank: e.rank, score: e.score }));
        expect(without.summary.curation.source).toBe("fallback");
        expect(shape(withCurator)).toEqual(shape(without));
      });
    });
  }
});
