import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BriefSource } from "@/lib/condition-brief/contract";
import { careNeedsSchema, generatedNeedsSchema, type CaseInput, type GeneratedNeeds } from "@/lib/contracts";
import { deriveSearchTerms, MemoryNeedsStore, needsCacheKey, NEEDS_CACHE_TTL_MS, runNeedsAnalyst, validateNeeds } from "@/lib/agents/needs";
import { boundedTerms } from "@/lib/agents/needs-judge-phase";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { centersAgent, centersNeedsQuery } from "@/lib/agents/research/centers";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import type { MessagesClient } from "@/lib/agents/runtime";

const NOW = "2026-10-01T00:00:00.000Z";
const src = (id: string, kind: BriefSource["kind"] = "genereviews"): BriefSource => ({
  id, kind, design: "genereviews", url: `https://www.ncbi.nlm.nih.gov/books/${id.split(":")[1]}/`, title: `Source ${id}`, fetchedAt: NOW, excerpt: "excerpt",
});
const SOURCES = [src("genereviews:NBK1494"), src("orphanet:ORPHA:286", "orphanet")];

const raw = (over: Partial<GeneratedNeeds> = {}): GeneratedNeeds => generatedNeedsSchema.parse({
  specialties: [{ id: "s1", specialty: "Vascular surgery", why: "Arterial events need surgeons used to fragile tissue.", plain: "Surgeons who know fragile blood vessels.", evidenceIds: ["genereviews:NBK1494"], searchTerms: ["connective tissue vascular surgery"] }],
  centerCapabilities: [
    { id: "c1", text: "A center that can write an emergency letter describing the condition.", plain: "A clinic that gives you an emergency letter.", evidenceIds: ["genereviews:NBK1494", "made-up:1"], searchTerms: ["emergency letter clinic"] },
    { id: "c2", text: "A center with a genetics clinic.", plain: "A genetics clinic.", evidenceIds: [], searchTerms: ["unsourced term"] },
    { id: "c3", text: "A center whose staff cite memory.", plain: "x", evidenceIds: ["pubmed:999"], searchTerms: ["invented source term"] },
  ],
  redFlags: [{ id: "r1", text: "You should stop taking your medication before visiting.", plain: "Stop meds.", appliesTo: ["institution"], evidenceIds: ["orphanet:ORPHA:286"] }],
  supportNeeds: [{ id: "n1", kind: "advocacy", text: "Groups that serve people with vEDS.", plain: "Support groups.", organizations: ["The Ehlers-Danlos Society"], evidenceIds: ["orphanet:ORPHA:286"], searchTerms: [] }],
  questions: [
    { id: "q1", resourceKind: "institution", text: "Do you have a vascular surgeon who treats vEDS?", evidenceIds: ["genereviews:NBK1494"] },
    { id: "q2", resourceKind: "institution", text: "Should I take a beta blocker?", evidenceIds: ["genereviews:NBK1494"] },
    { id: "q3", resourceKind: "trial", text: "Bring your genetic report.", evidenceIds: ["genereviews:NBK1494"] },
  ],
  ...over,
});

const CASE: CaseInput = { diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300, goals: ["second_opinion", "support"] };

describe("CareNeeds contract", () => {
  it("parses every recorded needs fixture", () => {
    for (const slug of ["vascular-eds", "epithelioid-sarcoma", "igg4-related-disease"]) {
      const parsed = generatedNeedsSchema.parse(JSON.parse(readFileSync(`fixtures/llm/needs/${slug}.json`, "utf8")));
      expect(parsed.specialties.length + parsed.centerCapabilities.length).toBeGreaterThan(0);
    }
  });
  it("rejects an unknown eligibility feature and a red flag without a resource kind", () => {
    expect(generatedNeedsSchema.safeParse({ trialEligibility: [{ id: "e", feature: "dose", text: "t", plain: "p", evidenceIds: [] }] }).success).toBe(false);
    expect(generatedNeedsSchema.safeParse({ redFlags: [{ id: "r", text: "t", plain: "p", appliesTo: [], evidenceIds: [] }] }).success).toBe(false);
  });
});

describe("validateNeeds (code drops unsourced and unsafe needs)", () => {
  const v = validateNeeds(raw(), SOURCES);
  it("drops needs with no evidence or only unknown evidence ids", () => {
    expect(v.centerCapabilities.map((c) => c.text)).toEqual(["A center that can write an emergency letter describing the condition."]);
    expect(v.centerCapabilities[0]!.evidenceIds).toEqual(["genereviews:NBK1494"]); // invented id stripped
    expect(v.dropped).toEqual(expect.arrayContaining([
      { id: "centerCapabilities:c2", reason: "unsourced" },
      { id: "centerCapabilities:c3", reason: "cites no fetched source" },
    ]));
  });
  it("drops medical-advice items and non-questions, keeps service questions", () => {
    expect(v.redFlags).toHaveLength(0);
    expect(v.questions.map((q) => q.text)).toEqual(["Do you have a vascular surgeon who treats vEDS?"]);
    expect(v.dropped.map((d) => d.id)).toEqual(expect.arrayContaining(["redFlags:r1", "questions:q2", "questions:q3"]));
  });
  it("re-ids kept items and maps cited sources to urls", () => {
    expect(v.specialties[0]!.id).toBe("spec-1");
    expect(v.centerCapabilities[0]!.id).toBe("cap-1");
    expect(v.sources.map((s) => s.id).sort()).toEqual(["genereviews:NBK1494", "orphanet:ORPHA:286"]);
    expect(v.sources.every((s) => s.url.startsWith("https://"))).toBe(true);
  });
  it("derives search terms only from kept (sourced) items", () => {
    expect(v.searchTerms.centers).toEqual(["emergency letter clinic", "connective tissue vascular surgery"]);
    expect(JSON.stringify(v.searchTerms)).not.toMatch(/unsourced term|invented source term/);
    expect(v.searchTerms.advocacy).toEqual(["the ehlers-danlos society"]);
    expect(v.searchTerms.trials).toEqual([]);
  });
  it("deriveSearchTerms rejects unsafe or malformed terms", () => {
    const t = deriveSearchTerms({ specialties: [], supportNeeds: [], centerCapabilities: [{ id: "c", text: "t", plain: "p", evidenceIds: ["x"], searchTerms: ["<script>", "a b c d e f g h", "sarcoma pathology review"] }] });
    expect(t.centers).toEqual(["sarcoma pathology review"]);
  });
});

describe("needs cache", () => {
  it("normalizes the disease and keys on subtype", () => {
    expect(needsCacheKey("Vascular Ehlers-Danlos Syndrome")).toBe(needsCacheKey("vascular ehlers danlos"));
    expect(needsCacheKey("IgG4-related disease")).toBe(needsCacheKey("IgG4 related"));
    expect(needsCacheKey("Epithelioid sarcoma", "proximal")).not.toBe(needsCacheKey("Epithelioid sarcoma", "distal"));
    expect(needsCacheKey("Epithelioid sarcoma", "proximal")).not.toBe(needsCacheKey("Epithelioid sarcoma"));
  });

  function fakeClient(body: GeneratedNeeds): MessagesClient & { calls: number } {
    const c = {
      calls: 0,
      messages: {
        create: async () => {
          c.calls++;
          return { content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: "end_turn", model: "claude-sonnet-5-5", usage: { input_tokens: 1, output_tokens: 1 } } as never;
        },
      },
    };
    return c;
  }

  it("reuses disease-level needs across cases within the TTL, personalizes per case, and refreshes after it", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    try {
      const needsStore = new MemoryNeedsStore();
      const client = fakeClient(raw());
      const collect = vi.fn(async () => ({ diseaseName: CASE.diseaseName, sources: SOURCES, prevalence: [], studies: [], research: [], registries: [], errors: [] }));
      const now = new Date(NOW);
      const deps = { store: new MemoryRunStore(), needsStore, offline: false, collect, client, now: () => now };
      const first = await runNeedsAnalyst("case-a", CASE, deps);
      expect(first?.fromCache).toBe(false);
      const second = await runNeedsAnalyst("case-b", { ...CASE, diseaseName: "vascular ehlers-danlos", homeState: "TX", goals: ["trial"] }, deps);
      expect(second?.fromCache).toBe(true);
      expect(client.calls).toBe(1);
      expect(collect).toHaveBeenCalledTimes(1);
      expect(second?.personal.homeState).toBe("TX");
      expect(second?.personal.notes.some((n) => n.text.includes("TX"))).toBe(true);
      expect(careNeedsSchema.parse(second).caseId).toBe("case-b");
      expect(await needsStore.loadNeeds("case-b")).toMatchObject({ caseId: "case-b", fromCache: true });

      const later = new Date(now.getTime() + NEEDS_CACHE_TTL_MS + 1000);
      const third = await runNeedsAnalyst("case-c", CASE, { ...deps, now: () => later });
      expect(third?.fromCache).toBe(false);
      expect(client.calls).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("never caches personal fields", async () => {
    const needsStore = new MemoryNeedsStore();
    const client = fakeClient(raw());
    await runNeedsAnalyst("case-a", { ...CASE, insurer: "Acme Health" }, {
      store: new MemoryRunStore(), needsStore, offline: false, client,
      collect: async () => ({ diseaseName: CASE.diseaseName, sources: SOURCES, prevalence: [], studies: [], research: [], registries: [], errors: [] }),
    });
    const base = await needsStore.findBase(needsCacheKey(CASE.diseaseName), new Date(0));
    expect(JSON.stringify(base)).not.toMatch(/Acme|OH\b|homeState|personal/);
  });

  it("offline: replays the recorded fixture for the three demo diseases with sourced needs only", async () => {
    for (const [slug, disease] of [["vascular-eds", "Vascular Ehlers-Danlos syndrome"], ["epithelioid-sarcoma", "Epithelioid sarcoma"], ["igg4-related-disease", "IgG4-related disease"]] as const) {
      const n = await runNeedsAnalyst(`c-${slug}`, { ...CASE, diseaseName: disease }, { store: new MemoryRunStore(), needsStore: new MemoryNeedsStore(), offline: true });
      expect(n, slug).toBeDefined();
      const ids = new Set(n!.sources.map((s) => s.id));
      for (const item of [...n!.specialties, ...n!.centerCapabilities, ...n!.redFlags, ...n!.trialEligibility, ...n!.supportNeeds]) {
        expect(item.evidenceIds.length).toBeGreaterThan(0);
        for (const id of item.evidenceIds) expect(ids.has(id), `${slug} ${id}`).toBe(true);
      }
    }
  });

  it("offline with a non-demo disease reports not_implemented and returns undefined", async () => {
    const store = new MemoryRunStore();
    expect(await runNeedsAnalyst("x", { ...CASE, diseaseName: "Unknown disease" }, { store, needsStore: new MemoryNeedsStore(), offline: true })).toBeUndefined();
    expect((await store.listByCase("x"))[0]?.status).toBe("not_implemented");
  });
});

describe("needs feed the searches", () => {
  it("centers runs one extra needs-driven query when terms arrive, none otherwise", async () => {
    const ports = createFixturePorts();
    const queries: string[] = [];
    const exa = { search: async (i: { query: string }) => { queries.push(i.query); return ports.exa.search(i); } };
    const ctx = { ports: { ...ports, exa }, store: new MemoryRunStore(), caseId: "c" };
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    try {
      await centersAgent.run(CASE, ctx);
      expect(queries).toHaveLength(1);
      queries.length = 0;
      const terms = { centers: ["connective tissue vascular surgery"], experts: [], trials: [], advocacy: [], aid: [] };
      await centersAgent.run(CASE, { ...ctx, needsTerms: async () => terms });
      expect(queries).toContain(centersNeedsQuery(CASE.diseaseName, terms.centers));
      expect(queries).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("boundedTerms gives up after the wait budget so needs never hold the searches longer", async () => {
    const never = new Promise<undefined>(() => {});
    const t = Date.now();
    expect(await boundedTerms(never, Date.now(), 50)).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("settleNeeds / pickUpLateNeeds", () => {
  it("returns a fast profile directly and hands a slow one to keepAlive", async () => {
    const { settleNeeds } = await import("@/lib/agents/needs-judge-phase");
    const fast = await settleNeeds(Promise.resolve(undefined), 50, () => { throw new Error("not late"); });
    expect(fast).toEqual({ needs: undefined, late: false });
    const kept: unknown[] = [];
    const slow = await settleNeeds(new Promise(() => undefined), 10, (w) => kept.push(w));
    expect(slow.late).toBe(true);
    expect(kept).toHaveLength(1);
  });
  it("polls the store until the late profile lands, or gives up", async () => {
    const { pickUpLateNeeds } = await import("@/lib/agents/needs-judge-phase");
    let calls = 0;
    const found = await pickUpLateNeeds("c1", async () => (++calls >= 3 ? ({ caseId: "c1" } as never) : null), 1_000, 5);
    expect(found).toEqual({ caseId: "c1" });
    expect(await pickUpLateNeeds("c1", async () => null, 20, 5)).toBeUndefined();
  });
});
