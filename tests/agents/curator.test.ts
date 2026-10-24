import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaseInput, Curation, Resource } from "@/lib/contracts";
import {
  BEST_PER_KIND,
  SUGGESTED_MAX,
  buildCuratorInput,
  fallbackCuration,
  runCurator,
  validateCuration,
} from "@/lib/agents/curator";
import type { RankedEntry } from "@/lib/agents/persist";
import { MemoryRunStore } from "@/lib/agents/run-store";
import type { MessagesClient } from "@/lib/agents/runtime";
import type { VerifiedRecord } from "@/lib/agents/verifier";

const ADVICE = "You should take 50 mg daily";

function entry(kind: Resource["kind"], n: number, rank: number, evN = 2, door: "email" | "web_form" | "program_page" | "none" = "email"): RankedEntry {
  const id = `${kind}-${n}`;
  const doorRows = {
    email: [{ id: `${id}-door`, claimType: "contact_point.email.org_contact", claim: `intake@example.org`, sourceUrl: "https://example.org/contact", sourceKind: "exa" as const, fetchedAt: "2026-01-01T00:00:00.000Z" }],
    web_form: [{ id: `${id}-door`, claimType: "contact_point.web_form.intake_form", claim: "https://example.org/form", sourceUrl: "https://example.org/program", sourceKind: "exa" as const, fetchedAt: "2026-01-01T00:00:00.000Z" }],
    program_page: [{ id: `${id}-door`, claimType: "program_page", claim: "https://example.org/program", sourceUrl: "https://example.org/program", sourceKind: "exa" as const, fetchedAt: "2026-01-01T00:00:00.000Z" }],
    none: [],
  }[door];
  const evidence = Array.from({ length: evN }, (_, i) => ({
    id: `${id}-ev${i}`,
    claimType: "publication",
    claim: `claim ${i}`,
    sourceUrl: "https://example.org/x",
    sourceKind: "pubmed" as const,
    fetchedAt: "2026-01-01T00:00:00.000Z",
  })).concat(doorRows as never[]);
  const resource: Resource =
    kind === "trial"
      ? { kind, id, nctId: `NCT0000000${n}`, title: `Trial ${n}`, evidenceRefs: [] }
      : kind === "expert"
        ? { kind, id, name: `Dr ${n}`, evidenceRefs: [] }
        : { kind, id, name: `${kind} ${n}`, evidenceRefs: [] };
  const record = { resource, key: id, evidence } as unknown as VerifiedRecord;
  return { record, rank, score: 100 - rank, breakdown: [{ factor: "f", points: 1, text: "t", evidenceIds: [] }] };
}

const reason = (id: string, i = 0) => ({ text: `fit ${i}`, evidenceIds: [`${id}-ev${i}`] });
const pick = (candidateId: string, tier: "best" | "good" | "backup" | "exclude", withReason = true) => ({
  candidateId,
  tier,
  reasons: withReason ? [reason(candidateId)] : [],
});
const cur = (picks: Curation["picks"], summary = "ok"): Curation => ({ picks, summary });

describe("validateCuration", () => {
  const ranked = [entry("expert", 1, 1), entry("expert", 2, 2), entry("trial", 1, 1)];

  it("drops unknown candidate ids", () => {
    const v = validateCuration(cur([pick("ghost", "best")]), ranked);
    expect(v.tiers.map((t) => t.candidateId)).not.toContain("ghost");
    expect(v.dropped).toContainEqual(expect.objectContaining({ candidateId: "ghost", what: "pick" }));
  });

  it("keeps the first of duplicate picks", () => {
    const v = validateCuration(cur([pick("expert-1", "good"), pick("expert-1", "best")]), ranked);
    expect(v.tiers.find((t) => t.candidateId === "expert-1")?.tier).toBe("good");
    expect(v.dropped.some((d) => d.what === "pick" && /duplicate/.test(d.why))).toBe(true);
  });

  it("drops reasons with no evidence or another candidate's evidence", () => {
    const v = validateCuration(
      cur([
        {
          candidateId: "expert-1",
          tier: "good",
          reasons: [
            { text: "none", evidenceIds: [] },
            { text: "foreign", evidenceIds: ["expert-2-ev0"] },
            { text: "mixed", evidenceIds: ["expert-1-ev0", "expert-2-ev0"] },
            { text: "valid", evidenceIds: ["expert-1-ev1"] },
          ],
        },
      ]),
      ranked,
    );
    expect(v.tiers.find((t) => t.candidateId === "expert-1")?.reasons.map((r) => r.text)).toEqual(["valid"]);
    expect(v.dropped.filter((d) => d.what === "reason")).toHaveLength(3);
  });

  it("drops medical-advice reasons and blanks a medical-advice summary", () => {
    const v = validateCuration(
      cur(
        [{ candidateId: "expert-1", tier: "good", reasons: [{ text: ADVICE, evidenceIds: ["expert-1-ev0"] }, reason("expert-1", 1)] }],
        ADVICE,
      ),
      ranked,
    );
    expect(v.tiers[0]?.reasons).toHaveLength(1);
    expect(v.summary).toBe("");
    expect(v.dropped.map((d) => d.what)).toEqual(expect.arrayContaining(["reason", "summary"]));
  });

  it("caps best per kind keeping the lowest ranks", () => {
    const many = [1, 2, 3, 4].map((n) => entry("expert", n, n));
    const v = validateCuration(cur([...many].reverse().map((e) => pick(e.record.resource.id, "best"))), many);
    const best = v.tiers.filter((t) => t.tier === "best").map((t) => t.candidateId);
    expect(best).toEqual(["expert-1", "expert-2"].slice(0, BEST_PER_KIND));
    expect(v.tiers.find((t) => t.candidateId === "expert-4")?.tier).toBe("good");
    expect(v.dropped.filter((d) => d.what === "best_over_cap")).toHaveLength(2);
  });

  it("demotes best with no valid reasons to good", () => {
    const v = validateCuration(cur([pick("expert-1", "best", false)]), ranked);
    expect(v.tiers.find((t) => t.candidateId === "expert-1")?.tier).toBe("good");
    expect(v.suggested).not.toContain("expert-1");
  });

  it("gives missing candidates a backup tier and keeps input order, rank and score", () => {
    const v = validateCuration(cur([pick("trial-1", "best")]), [ranked[2]!, ranked[1]!, ranked[0]!]);
    expect(v.tiers.map((t) => t.candidateId)).toEqual(["expert-1", "expert-2", "trial-1"]);
    expect(v.tiers[0]).toMatchObject({ tier: "backup", reasons: [] });
    expect(ranked.map((r) => [r.rank, r.score])).toEqual([[1, 99], [2, 98], [1, 99]]);
    expect(v.source).toBe("model");
  });

  it("suggests at most SUGGESTED_MAX best, ordered by kind then rank", () => {
    const all = [
      ...[1, 2, 3].map((n) => entry("organization", n, n)),
      ...[1, 2, 3].map((n) => entry("trial", n, n)),
      ...[1, 2, 3].map((n) => entry("expert", n, n)),
      ...[1, 2, 3].map((n) => entry("institution", n, n)),
    ];
    const v = validateCuration(cur(all.map((e) => pick(e.record.resource.id, "best"))), all);
    expect(v.suggested).toHaveLength(SUGGESTED_MAX);
    expect(v.suggested).toEqual(["expert-1", "expert-2", "institution-1", "institution-2", "trial-1"]);
  });
});

describe("suggested requires a contact route", () => {
  it("never pre-selects a best pick with no contact route, but keeps its tier", () => {
    const all = [entry("organization", 1, 1, 2, "program_page"), entry("organization", 2, 2, 2, "none"), entry("expert", 1, 1)];
    const v = validateCuration(cur(all.map((e) => pick(e.record.resource.id, "best"))), all);
    expect(v.suggested).toEqual(["expert-1"]);
    expect(v.tiers.find((t) => t.candidateId === "organization-1")?.tier).toBe("best");
  });
  it("prefers reachable resources and counts an online form as reachable", () => {
    const all = [entry("expert", 1, 1, 2, "none"), entry("expert", 2, 2, 2, "web_form"), entry("trial", 1, 1)];
    const v = validateCuration(cur(all.map((e) => pick(e.record.resource.id, "best"))), all);
    expect(v.suggested).toEqual(["expert-2", "trial-1"]);
  });
  it("suggests nothing when no best pick is reachable", () => {
    const all = [entry("organization", 1, 1, 2, "none")];
    expect(validateCuration(cur([pick("organization-1", "best")]), all).suggested).toEqual([]);
  });
});

describe("fallbackCuration", () => {
  it("is all backup with no summary", () => {
    const f = fallbackCuration([entry("trial", 1, 1), entry("expert", 1, 1)], "boom");
    expect(f.tiers.map((t) => [t.candidateId, t.tier])).toEqual([["expert-1", "backup"], ["trial-1", "backup"]]);
    expect(f).toMatchObject({ summary: "", suggested: [], source: "fallback", dropped: [{ what: "pick", why: "boom" }] });
  });
});

describe("buildCuratorInput", () => {
  it("maps case and candidate fields", () => {
    const c: CaseInput = {
      diseaseName: "Rare X",
      subtype: "type 2",
      homeState: "CA",
      homeCity: "Oakland",
      travelLimitMiles: 200,
      insurer: "Acme",
      goals: ["second_opinion", "trial"],
    };
    const input = buildCuratorInput(c, [entry("trial", 1, 1), entry("expert", 1, 1)]);
    expect(input.case).toEqual({ diagnosis: "Rare X", subtype: "type 2", state: "CA", city: "Oakland", travelLimitMiles: 200, goals: ["second_opinion", "trial"], insurer: "Acme" });
    expect(input.candidates.map((x) => x.candidateId)).toEqual(["expert-1", "trial-1"]);
    expect(input.candidates[1]).toMatchObject({ kind: "trial", name: "Trial 1", rank: 1, score: 99 });
    expect(input.candidates[0]?.evidence[0]).toEqual({ id: "expert-1-ev0", claimType: "publication", claim: "claim 0", sourceKind: "pubmed" });
  });
});

describe("runCurator", () => {
  const caseRecord: CaseInput = { diseaseName: "Rare X", goals: [] };
  const ranked = [entry("expert", 1, 1), entry("expert", 2, 2)];
  const calls: unknown[] = [];
  let reply = "";
  const client: MessagesClient = {
    messages: {
      create: async (p) => {
        calls.push(p);
        return { stop_reason: "end_turn", content: [{ type: "text", text: reply, citations: null }] } as unknown as Anthropic.Message;
      },
    },
  };

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("WAYFINDER_OFFLINE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    vi.stubEnv("WAYFINDER_RECORD_LLM", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("validates a model reply", async () => {
    reply = JSON.stringify(cur([pick("expert-1", "best"), pick("ghost", "good")], "Two good fits."));
    const store = new MemoryRunStore();
    const v = await runCurator("c1", caseRecord, ranked, { store, offlineKey: "k", client });
    expect(v.source).toBe("model");
    expect(v.suggested).toEqual(["expert-1"]);
    expect(v.summary).toBe("Two good fits.");
    expect(v.dropped).toHaveLength(1);
    expect((await store.listByCase("c1"))[0]).toMatchObject({ agent: "curator", status: "done" });
  });

  it("falls back when the output contains medical advice", async () => {
    reply = JSON.stringify(cur([pick("expert-1", "best")], ADVICE));
    const v = await runCurator("c1", caseRecord, ranked, { store: new MemoryRunStore(), offlineKey: "k", client });
    expect(v.source).toBe("fallback");
    expect(v.tiers.every((t) => t.tier === "backup")).toBe(true);
    expect(v.dropped[0]?.why).toMatch(/medical advice/);
  });

  it("returns an empty curation without calling the model when nothing is ranked", async () => {
    const v = await runCurator("c1", caseRecord, [], { store: new MemoryRunStore(), offlineKey: "k", client });
    expect(v.tiers).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("falls back (never throws) when the offline fixture is missing", async () => {
    vi.stubEnv("WAYFINDER_OFFLINE", "1");
    const v = await runCurator("c1", caseRecord, ranked, { store: new MemoryRunStore(), offlineKey: "no-such-key" });
    expect(v.source).toBe("fallback");
    expect(calls).toHaveLength(0);
  });
});
