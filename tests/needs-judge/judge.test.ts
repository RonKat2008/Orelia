import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { judgeFromRaw, runJudge, toCuration } from "@/lib/agents/judge";
import type { RankedEntry } from "@/lib/agents/persist";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { rawJudgeOutputSchema, type CaseInput, type RawJudgeOutput, type RawJudgement } from "@/lib/contracts";
import type { MessagesClient } from "@/lib/agents/runtime";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const ev = (id: string, claim = "claim text", sourceKind: "exa" | "ctgov" | "nppes" = "exa") => ({
  id, claimType: "disease_program", claim, sourceUrl: `https://example.org/${id}`, sourceKind, fetchedAt: NOW.toISOString(),
});
const breakdown = (ids: string[]) => [{ factor: "subtypeExpertise", points: 40, text: "Web page describes a dedicated program.", evidenceIds: ids }];

const inst = (id: string, state: string, score: number, rank: number, name = `Center ${id}`): RankedEntry => ({
  record: { resource: { kind: "institution", id, name, state, evidenceRefs: [`ev-${id}`] }, key: `inst:${id}`, evidence: [ev(`ev-${id}`)] },
  score, rank, breakdown: breakdown([`ev-${id}`]),
});
const pedsTrial: RankedEntry = {
  record: {
    resource: { kind: "trial", id: "t1", nctId: "NCT01234567", title: "A study in children", evidenceRefs: ["ev-t1"],
      registry: { conditions: ["X"], keywords: [], meshTerms: [], stdAges: ["CHILD"], phases: ["PHASE2"], usSiteCount: 3, usRecruitingSiteCount: 3, recruitingSiteStates: ["OH"], investigators: [], hasContact: true } },
    key: "trial:t1", evidence: [ev("ev-t1", "registry", "ctgov")],
  },
  score: 80, rank: 1, breakdown: breakdown(["ev-t1"]),
};

const CASE: CaseInput = { diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300, goals: [] };
const ENTRIES = [inst("a", "OH", 60, 1), inst("b", "CA", 55, 2), inst("c", "PA", 50, 3), pedsTrial];

const j = (candidateId: string, over: Partial<RawJudgement> = {}): RawJudgement => ({
  candidateId, verdict: "keep", tier: "best", reason: "Has a dedicated clinic", plain: "This clinic has a team for your condition.",
  evidenceIds: [`ev-${candidateId}`], needsMet: [], needsMissed: [], confidence: "high", ...over,
});
const judge = (raw: RawJudgeOutput | undefined) => judgeFromRaw("case", CASE, ENTRIES, undefined, raw, { model: "m", elapsedMs: 1, now: NOW });
const find = (r: ReturnType<typeof judge>, id: string) => r.judgements.find((x) => x.candidateId === id)!;

describe("final judge guardrails", () => {
  it("rejects a hallucinated evidence id and removes it from the verdict", () => {
    const r = judge({ judgements: [j("a", { evidenceIds: ["ev-a", "ev-not-in-input"] })], summary: "" });
    expect(find(r, "a").evidenceIds).toEqual(["ev-a"]);
    expect(find(r, "a").verdict).toBe("keep");
    expect(r.rejected).toContainEqual({ candidateId: "a", why: "cited evidence ids not in its input: ev-not-in-input" });
  });

  it("cannot cite another candidate's evidence; a keep left without evidence becomes a drop with a reason", () => {
    const r = judge({ judgements: [j("a", { evidenceIds: ["ev-b"] }), j("c", { evidenceIds: [] })], summary: "" });
    for (const id of ["a", "c"]) {
      expect(find(r, id).verdict).toBe("drop");
      expect(find(r, id).tier).toBe("exclude");
      expect(find(r, id).reason).toMatch(/no valid evidence/);
      expect(find(r, id).overrides.join()).toMatch(/keep without valid evidence -> drop/);
    }
  });

  it("cannot override a hard scope rule (pediatric-only trial is dropped)", () => {
    const r = judge({ judgements: [j("t1")], summary: "" });
    expect(find(r, "t1").verdict).toBe("drop");
    expect(find(r, "t1").flags.map((f) => f.code)).toContain("pediatric_only");
    expect(find(r, "t1").reason).toMatch(/children/i);
  });

  it("shows the travel flag and caps a beyond-limit pick at good", () => {
    const r = judge({ judgements: [j("b")], summary: "" });
    const b = find(r, "b");
    expect(b.tier).toBe("good");
    expect(b.reason).toMatch(/mi beyond your 300-mile travel limit/);
    expect(b.flags[0]).toMatchObject({ code: "beyond_travel", hard: false });
  });

  it("does not repeat the travel flag when the reason already states it", () => {
    const r = judge({ judgements: [j("b", { reason: "Treats this condition · Seattle, past the 300-mile limit" })], summary: "" });
    expect(find(r, "b").reason).toBe("Treats this condition · Seattle, past the 300-mile limit");
  });

  it("every drop has a reason; unknown and duplicate candidates are rejected; unjudged candidates become a scored maybe", () => {
    const r = judge({ judgements: [j("a", { verdict: "drop", reason: "Wrong condition" }), j("a"), j("zzz")], summary: "" });
    expect(r.rejected.map((x) => x.why)).toEqual(expect.arrayContaining(["duplicate judgement", "unknown candidateId (not in the judge's input)"]));
    for (const x of r.judgements.filter((x) => x.verdict === "drop")) expect(x.reason.length).toBeGreaterThan(0);
    expect(find(r, "c")).toMatchObject({ verdict: "maybe", source: "fallback" });
  });

  it("replaces medical-advice wording with code text and strips need ids from patient text", () => {
    const r = judge({ judgements: [j("a", { reason: "You should stop taking your medication first", plain: "Has the team you need (cap-1)." })], summary: "We recommend you start therapy now." });
    expect(find(r, "a").reason).not.toMatch(/medication/);
    expect(find(r, "a").plain).toBe("Has the team you need.");
    expect(r.summary).toBe("");
  });

  it("is stable: same verdicts and order whatever order the model returns them in", () => {
    const js = [j("a"), j("b", { tier: "good" }), j("c", { verdict: "maybe", tier: "good" })];
    const one = judge({ judgements: js, summary: "" });
    const two = judge({ judgements: [...js].reverse(), summary: "" });
    expect(two.judgements).toEqual(one.judgements);
    expect(one.judgements.map((x) => x.order)).toEqual([1, 2, 3, 4]);
    expect(one.judgements.map((x) => x.verdict)).toEqual(["keep", "keep", "maybe", "drop"]);
  });

  it("keeps the deterministic score and rank next to every verdict", () => {
    const r = judge({ judgements: [j("a")], summary: "" });
    expect(find(r, "a")).toMatchObject({ score: 60, rank: 1 });
  });

  it("toCuration maps drops to exclude and suggests only best keeps with a contact route", () => {
    const r = judge({ judgements: [j("a"), j("c", { verdict: "drop", reason: "Off target" })], summary: "" });
    const c = toCuration(r, ENTRIES);
    expect(c.tiers.find((t) => t.candidateId === "c")?.tier).toBe("exclude");
    expect(c.tiers.find((t) => t.candidateId === "a")?.reasons[0]?.evidenceIds).toEqual(["ev-a"]);
    expect(c.suggested).toEqual([]); // no contact_point evidence in these entries
  });

  it("falls back to scored maybes (never keeps) when the model fails", async () => {
    const client: MessagesClient = { messages: { create: async () => { throw new Error("model down"); } } };
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      const { result, curation } = await runJudge("case", CASE, ENTRIES, undefined, { store: new MemoryRunStore(), offlineKey: "none", client, now: () => NOW });
      expect(result.source).toBe("fallback");
      expect(result.judgements.every((x) => x.verdict !== "keep")).toBe(true);
      expect(find(result, "t1").verdict).toBe("drop");
      expect(curation.source).toBe("fallback");
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("recorded judge fixtures parse", () => {
    for (const slug of ["vascular-eds", "epithelioid-sarcoma", "igg4-related-disease"]) {
      expect(rawJudgeOutputSchema.parse(JSON.parse(readFileSync(`fixtures/llm/judge/${slug}.json`, "utf8"))).judgements.length).toBeGreaterThan(0);
    }
  });
});

describe("parallel chunked judging", () => {
  const many: RankedEntry[] = Array.from({ length: 10 }, (_, i) => inst(`n${i}`, "OH", 60 - i, i + 1));
  function client(opts: { failOn?: string; delayMs?: number } = {}) {
    let inFlight = 0;
    const state = { calls: 0, maxInFlight: 0 };
    const c: MessagesClient = {
      messages: {
        create: async (params) => {
          state.calls++;
          inFlight++;
          state.maxInFlight = Math.max(state.maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, opts.delayMs ?? 5));
          inFlight--;
          const prompt = String((params.messages[0] as { content: string }).content);
          const ids = [...prompt.matchAll(/"candidateId": "([^"]+)"/g)].map((m) => m[1]!);
          if (opts.failOn && ids.includes(opts.failOn)) throw new Error("chunk down");
          const body = { judgements: ids.map((id) => j(id)), summary: "" };
          return { content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: "end_turn", model: "claude-opus-5-5", usage: { input_tokens: 100, output_tokens: 50 } } as never;
        },
      },
    };
    return { c, state };
  }

  it("splits candidates into chunks, runs them with bounded concurrency, sums usage on one row and reports progress", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      const { c, state } = client({ delayMs: 20 });
      const store = new MemoryRunStore();
      const updates: string[] = [];
      const spy = { ...store, create: store.create.bind(store), listByCase: store.listByCase.bind(store), update: async (id: string, p: Parameters<MemoryRunStore["update"]>[1]) => { if (p.outputSummary) updates.push(p.outputSummary); return store.update(id, p); } };
      const { result } = await runJudge("case", CASE, many, undefined, { store: spy, offlineKey: "none", client: c, now: () => NOW, chunkSize: 3, concurrency: 2 });
      expect(state.calls).toBe(4);
      expect(state.maxInFlight).toBeLessThanOrEqual(2);
      expect(result.source).toBe("model");
      expect(result.judgements.filter((x) => x.source === "model")).toHaveLength(10);
      const rows = await store.listByCase("case");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.agent).toBe("judge");
      expect(rows[0]!.status).toBe("done");
      expect(rows[0]!.tokensIn).toBe(400);
      expect(updates.some((u) => /^Judged \d+ of 10/.test(u))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it("a failed chunk leaves only its candidates as scored maybes; guardrails still apply to the rest", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test";
    try {
      const { c } = client({ failOn: "n0" });
      const { result } = await runJudge("case", CASE, many, undefined, { store: new MemoryRunStore(), offlineKey: "none", client: c, now: () => NOW, chunkSize: 4 });
      const failed = result.judgements.filter((x) => x.source === "fallback").map((x) => x.candidateId).sort();
      expect(failed).toEqual(["n0", "n1", "n2", "n3"]);
      expect(result.judgements.filter((x) => x.source === "fallback").every((x) => x.verdict !== "keep")).toBe(true);
      expect(result.source).toBe("model");
      expect(result.rejected[0]?.why).toMatch(/1 of 3 judge call\(s\) failed/);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
