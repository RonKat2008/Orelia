import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCaseStore } from "@/lib/agents/case-store";
import { runResearch } from "@/lib/agents/orchestrator";
import { MemoryPersist } from "@/lib/agents/persist";
import { researchAgents } from "@/lib/agents/research";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { computeSignals } from "@/lib/agents/signals";
import { deterministicUuid, type VerifiedRecord } from "@/lib/agents/verifier";
import type { CaseInput, Resource } from "@/lib/contracts";

const CASES: CaseInput[] = [
  { diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600, goals: ["second_opinion", "trial"] },
  { diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300, goals: ["second_opinion"] },
  { diseaseName: "IgG4-related disease", homeState: "NC", travelLimitMiles: 150, goals: ["second_opinion", "aid"] },
];

beforeEach(() => vi.stubEnv("WAYFINDER_OFFLINE", "1"));
afterEach(() => vi.unstubAllEnvs());

async function shortlistFor(input: CaseInput) {
  const cases = new MemoryCaseStore();
  const persist = new MemoryPersist();
  const created = await cases.create(input, "confirmed");
  await runResearch(created.id, {
    store: new MemoryRunStore(), persist, cases, ports: createFixturePorts(), agents: researchAgents,
  });
  return persist.getShortlist(created.id);
}

describe("offline pipeline ranking", () => {
  it.each(CASES)("is deterministic and differentiated: $diseaseName", async (input) => {
    const a = await shortlistFor(input);
    const b = await shortlistFor(input);
    const view = (list: typeof a) => list.map((i) => [i.targetKind, i.name, i.rank, i.score]);
    expect(view(a)).toEqual(view(b));
    expect(a.length).toBeGreaterThan(0);
    for (const kind of new Set(a.map((i) => i.targetKind))) {
      const group = a.filter((i) => i.targetKind === kind);
      expect(group.map((i) => i.rank)).toEqual(group.map((_, i) => i + 1));
      if (group.length >= 3) expect(new Set(group.map((i) => i.score)).size).toBeGreaterThan(1);
    }
    for (const item of a) {
      for (const bd of item.breakdown) {
        if (bd.points > 0) expect(bd.evidenceIds.length).toBeGreaterThan(0);
        for (const id of bd.evidenceIds) expect(item.evidence.some((e) => e.id === id)).toBe(true);
      }
    }
  });

  it("epithelioid sarcoma: off-target and pediatric trials never reach the shortlist (snapshot)", async () => {
    const list = await shortlistFor(CASES[0]!);
    const trials = list.filter((i) => i.targetKind === "trial");
    const titles = trials.map((t) => t.name).join(" | ");
    expect(titles).not.toMatch(/Clonal Hematopoiesis|Uterine|Zoledronic/);
    expect(list.map((i) => `${i.targetKind} #${i.rank} ${i.name} ${i.score}`)).toMatchSnapshot();
  });

  it("verified and unverified records of the same person are one shortlist row", async () => {
    const list = await shortlistFor(CASES[0]!);
    const names = list.filter((i) => i.targetKind === "expert").map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("computeSignals", () => {
  const ev = (id: string, claimType: string, sourceKind: "pubmed" | "nppes" | "ctgov" | "nci" | "exa", claim = "claim") =>
    ({ id, claimType, claim, sourceKind, sourceUrl: `https://example.org/${id}`, fetchedAt: "2026-01-01T00:00:00.000Z" });
  const record = (resource: Resource, evidence: ReturnType<typeof ev>[]): VerifiedRecord => ({
    resource: { ...resource, id: deterministicUuid(resource.id) }, key: resource.id, evidence,
  });
  const c = { diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600, goals: [] as CaseInput["goals"] };

  it("more disease-specific papers, recent papers and a verified NPI score higher", () => {
    const strong = record(
      { kind: "expert", id: "a", name: "Ada Strong", npi: "1", verified: true, profile: { paperCount: 8, recentPaperCount: 4, state: "AZ" }, evidenceRefs: [] },
      [ev("p1", "disease_publications", "pubmed"), ev("n1", "identity_verified", "nppes")],
    );
    const weak = record(
      { kind: "expert", id: "b", name: "Bo Weak", npi: null, profile: { paperCount: 1, recentPaperCount: 0, state: "PA" }, evidenceRefs: [] },
      [ev("p2", "disease_publications", "pubmed")],
    );
    const s = computeSignals(strong, [strong, weak], c);
    const w = computeSignals(weak, [strong, weak], c);
    expect(s.subtypeExpertise!.value).toBeGreaterThan(w.subtypeExpertise!.value);
    expect(s.institutionalFit?.value).toBe(0.4);
    expect(w.institutionalFit).toBeUndefined();
    expect(s.access!.value).toBeGreaterThan(w.access!.value);
    expect(s.subtypeExpertise!.text).toMatch(/8 PubMed paper/);
  });

  it("trials led count toward expertise and cite the trial's evidence", () => {
    const expert = record(
      { kind: "expert", id: "a", name: "Fugen Li", npi: null, profile: { paperCount: 1 }, evidenceRefs: [] },
      [ev("p1", "disease_publications", "pubmed")],
    );
    const trial = record(
      { kind: "trial", id: "t", nctId: "NCT00000001", title: "T", evidenceRefs: [], registry: {
        conditions: ["Epithelioid Sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"], usSiteCount: 1,
        usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: ["Fugen Li, MD"], hasContact: true } },
      [ev("t1", "trial_recruiting", "ctgov")],
    );
    const s = computeSignals(expert, [expert, trial], c);
    expect(s.subtypeExpertise!.evidenceIds).toEqual(["p1", "t1"]);
    expect(s.subtypeExpertise!.text).toMatch(/overall official on 1 recruiting trial/);
  });

  it("dedicated adult trial with recruiting nearby sites beats an umbrella study with none recruiting", () => {
    const mk = (id: string, conditions: string[], recruiting: number, states: string[]) =>
      record(
        { kind: "trial", id, nctId: "NCT0000000" + id, title: "T", evidenceRefs: [], registry: {
          conditions, keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"], usSiteCount: 2,
          usRecruitingSiteCount: recruiting, recruitingSiteStates: states, investigators: [], hasContact: true } },
        [ev("e" + id, "trial_recruiting", "ctgov")],
      );
    const dedicated = computeSignals(mk("1", ["Epithelioid Sarcoma"], 2, ["AZ"]), [], c);
    const umbrella = computeSignals(mk("2", Array.from({ length: 30 }, (_, i) => (i === 0 ? "Epithelioid Sarcoma" : `X${i}`)), 0, []), [], c);
    expect(dedicated.subtypeExpertise!.value).toBeGreaterThan(umbrella.subtypeExpertise!.value);
    expect(dedicated.access!.value).toBeGreaterThan(umbrella.access!.value);
  });

  it("organizations: disease-specific beats general; a signal with no evidence is omitted", () => {
    const org = (name: string, claim: string) =>
      record({ kind: "organization", id: name, name, organizationKind: "advocacy", url: "https://example.org/", evidenceRefs: [] }, [ev(name, "advocacy_organization", "exa", claim)]);
    const specific = computeSignals(org("Epithelioid Sarcoma Foundation", "Support for epithelioid sarcoma"), [], c);
    const general = computeSignals(org("Rare Things", "Help for rare conditions"), [], c);
    expect(specific.subtypeExpertise!.value).toBe(1);
    expect(general.subtypeExpertise!.value).toBe(0.2);
    const bare = record({ kind: "organization", id: "x", name: "X", evidenceRefs: [] }, []);
    expect(computeSignals(bare, [], c)).toEqual({});
  });
});
