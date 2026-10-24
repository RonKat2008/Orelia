import { describe, expect, it, vi } from "vitest";
import { buildConditionBrief, ConditionBriefUnavailableError, fixtureSlugFor } from "@/lib/condition-brief/build";
import { conditionBriefSchema, type GeneratedBrief } from "@/lib/condition-brief/contract";
import { collectAll, mergeCollected } from "@/lib/condition-brief/sources";
import type { CollectContext, Collector } from "@/lib/condition-brief/sources/types";
import { MemoryConditionBriefStore } from "@/lib/condition-brief/store";
import { FixtureTransport } from "@/lib/sources/transport";
import { makeBrief } from "./brief-fixture";
import { collected, src, stmt } from "./core-fixture";

const CASE = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const GEN: GeneratedBrief = {
  statements: [stmt("s1", ["pubmed:111"]) as GeneratedBrief["statements"][number], stmt("s2", ["pubmed:999"]) as GeneratedBrief["statements"][number]],
  questions: [{ id: "q1", text: "What does this case report describe?", statementIds: ["s1", "s2"] }],
};

const deps = (over: Parameters<typeof buildConditionBrief>[2] = {}) => ({
  offline: true,
  now: () => NOW,
  store: new MemoryConditionBriefStore(),
  transport: new FixtureTransport(),
  collect: vi.fn(async () => collected({ errors: [{ source: "reference", message: "Source unavailable" }] })),
  generate: vi.fn(async () => GEN),
  ...over,
});

describe("fixtureSlugFor", () => {
  it("maps only the three demo conditions", () => {
    expect(fixtureSlugFor("Epithelioid sarcoma, proximal type")).toBe("epithelioid-sarcoma");
    expect(fixtureSlugFor("Vascular Ehlers-Danlos syndrome")).toBe("vascular-eds");
    expect(fixtureSlugFor("IgG4-related disease")).toBe("igg4-related-disease");
    expect(fixtureSlugFor("Fabry disease")).toBeUndefined();
  });
});

describe("buildConditionBrief", () => {
  it("collects, generates, validates and assembles a schema-valid brief", async () => {
    const d = deps();
    const brief = await buildConditionBrief(CASE, "Vascular Ehlers-Danlos syndrome", d);
    expect(conditionBriefSchema.parse(brief)).toEqual(brief);
    expect(brief).toMatchObject({ caseId: CASE, version: 1, mode: "offline", generatedAt: NOW.toISOString() });
    expect(brief.statements.map(s => [s.id, s.evidenceLevel])).toEqual([["s1", "uncertain"]]);
    expect(brief.questions[0].statementIds).toEqual(["s1"]);
    expect(brief.dropped.map(d => d.id)).toEqual(expect.arrayContaining(["s2", "collector:reference"]));
    // only cited / referenced sources are kept
    expect(brief.sources.map(s => s.id).sort()).toEqual(["ctgov:NCT00000001", "orphanet:1", "pubmed:111", "pubmed:333", "registry:r1"]);
    const ctx = vi.mocked(d.collect).mock.calls[0][1] as CollectContext;
    expect(ctx).toMatchObject({ offline: true, fixtureSlug: "vascular-eds", now: NOW });
    expect(vi.mocked(d.generate).mock.calls[0][1]).toMatchObject({ offline: true, fixtureSlug: "vascular-eds" });
  });

  it("increments the version from the stored brief", async () => {
    const store = new MemoryConditionBriefStore();
    await store.save(makeBrief(CASE, { version: 4 }));
    expect((await buildConditionBrief(CASE, "Vascular Ehlers-Danlos syndrome", deps({ store }))).version).toBe(5);
  });

  it("refuses an unknown disease offline without collecting", async () => {
    const d = deps();
    await expect(buildConditionBrief(CASE, "Fabry disease", d)).rejects.toBeInstanceOf(ConditionBriefUnavailableError);
    expect(vi.mocked(d.collect)).not.toHaveBeenCalled();
  });

  it("live generation failure still returns collector items and zero statements", async () => {
    const d = deps({ offline: false, generate: vi.fn(async () => { throw new Error("gateway down"); }) });
    const brief = await buildConditionBrief(CASE, "Fabry disease", d);
    expect(brief.mode).toBe("live");
    expect(brief.statements).toEqual([]);
    expect(brief.questions).toEqual([]);
    expect(brief.studies).toHaveLength(1);
    expect(brief.registries).toHaveLength(1);
    expect(brief.dropped.find(x => x.id === "generator")?.reason).toMatch(/failed/);
  });

  it("offline generation failure is surfaced (fixture missing is a bug, not a fallback)", async () => {
    const d = deps({ generate: vi.fn(async () => { throw new Error("Offline fixture not found"); }) });
    await expect(buildConditionBrief(CASE, "IgG4-related disease", d)).rejects.toThrow(/fixture/);
  });
});

describe("collectAll", () => {
  const ctx = { transport: new FixtureTransport(), offline: true, fixtureSlug: "vascular-eds", now: NOW } satisfies CollectContext;

  it("merges collectors, de-dupes by source id and captures failures generically", async () => {
    const a: Collector = async () => ({ sources: [src("orphanet:1", "orphanet", "reference_page", { title: "first" })], prevalence: [{ label: "x", sourceId: "orphanet:1" }] });
    const b: Collector = async () => ({ sources: [src("orphanet:1", "orphanet", "reference_page", { title: "second" }), src("pubmed:1", "pubmed", "primary_study")], errors: [{ source: "pubmed", message: "partial" }] });
    const boom: Collector = async () => { throw new Error("https://secret.example/?api_key=SECRET"); };
    const out = await collectAll("Vascular Ehlers-Danlos syndrome", ctx, { a, b, boom });
    expect(out.diseaseName).toBe("Vascular Ehlers-Danlos syndrome");
    expect(out.sources.map(s => [s.id, s.title])).toEqual([["orphanet:1", "first"], ["pubmed:1", "Synthetic pubmed:1"]]);
    expect(out.prevalence).toHaveLength(1);
    expect(out.errors).toEqual([{ source: "pubmed", message: "partial" }, { source: "boom", message: "Source unavailable" }]);
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("mergeCollected tolerates empty slices", () => {
    expect(mergeCollected("X", [{}, {}])).toEqual({ diseaseName: "X", sources: [], prevalence: [], studies: [], research: [], registries: [], errors: [] });
  });
});
