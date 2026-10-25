import { describe, expect, it } from "vitest";
import {
  buildConditionCard,
  codeLink,
  nearestCare,
  plainPrevalence,
  type ConditionCardInput,
} from "@/lib/rare-disease/condition-facts";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import type { JudgeResult, Judgement } from "@/lib/contracts/judge";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const FETCHED = "2026-10-01T00:00:00.000Z";

function brief(overrides: Partial<ConditionBrief> = {}): ConditionBrief {
  return {
    caseId: CASE_ID,
    diseaseName: "Vascular Ehlers-Danlos syndrome",
    version: 1,
    generatedAt: FETCHED,
    mode: "offline",
    sources: [
      { id: "orphanet:ORPHA:286", kind: "orphanet", design: "reference_page", url: "https://www.orpha.net/en/disease/detail/286", title: "Orphanet: vEDS", fetchedAt: FETCHED },
      { id: "gard:1", kind: "gard", design: "reference_page", url: "https://rarediseases.info.nih.gov/diseases/1", title: "GARD", fetchedAt: FETCHED },
    ],
    prevalence: [{ label: "1-9 / 100 000", prevalenceType: "Point prevalence", geography: "Worldwide", sourceId: "orphanet:ORPHA:286" }],
    statements: [],
    studies: [],
    research: [],
    registries: [],
    questions: [],
    dropped: [],
    ...overrides,
  };
}

function judgement(overrides: Partial<Judgement>): Judgement {
  return {
    candidateId: "c1",
    kind: "expert",
    name: "Dr. A",
    verdict: "keep",
    tier: "top",
    reason: "r",
    plain: "p",
    evidenceIds: ["e1"],
    links: [{ id: "e1", url: "https://example.org/a", claim: "Publishes on vEDS" }],
    needsMet: [],
    needsMissed: [],
    confidence: "high",
    flags: [],
    score: 1,
    rank: 1,
    order: 1,
    overrides: [],
    source: "model",
    ...overrides,
  } as Judgement;
}

function judge(judgements: Judgement[]): JudgeResult {
  return { caseId: CASE_ID, generatedAt: FETCHED, source: "model", model: "m", summary: "", counts: { keep: 0, maybe: 0, drop: 0 }, judgements, rejected: [], elapsedMs: 1 };
}

const travel = (nearestMiles: number, travelLimitMiles = 300) => ({ homeState: "TX", nearestState: "MD", nearestMiles, travelLimitMiles, withinTravelLimit: nearestMiles <= travelLimitMiles });

function input(overrides: Partial<ConditionCardInput> = {}): ConditionCardInput {
  return {
    caseId: CASE_ID,
    case: { diseaseName: "Vascular Ehlers-Danlos syndrome", diseaseCodes: { orpha: "ORPHA:286", omim: "130050", mesh: "D004535", icd10: "Q79.6" } },
    brief: brief(),
    judge: judge([
      judgement({ candidateId: "e1", travel: travel(1200) }),
      judgement({ candidateId: "e2", verdict: "maybe", travel: travel(420), links: [{ id: "x", url: "https://example.org/near", claim: "c" }] }),
      judgement({ candidateId: "e3", verdict: "drop", travel: travel(10) }),
      judgement({ candidateId: "i1", kind: "institution", name: "Center" }),
      judgement({ candidateId: "t1", kind: "trial", name: "Trial" }),
    ]),
    ...overrides,
  };
}

const kinds = (card: ReturnType<typeof buildConditionCard>) => card.facts.map((f) => f.kind);

describe("buildConditionCard", () => {
  it("shows the condition name from the case, linked to the Orphanet source when the brief has one", () => {
    const card = buildConditionCard(input());
    const name = card.facts.find((f) => f.kind === "name");
    expect(name?.value).toBe("Vascular Ehlers-Danlos syndrome");
    expect(name?.source.href).toBe("https://www.orpha.net/en/disease/detail/286");
  });

  it("links the name to the documents page when there is no Orphanet source", () => {
    const card = buildConditionCard(input({ brief: null }));
    expect(card.facts.find((f) => f.kind === "name")?.source.href).toBe(`/cases/${CASE_ID}/documents`);
  });

  it("links every valid code to its registry page", () => {
    const codes = buildConditionCard(input()).facts.filter((f) => f.kind === "code");
    expect(codes.map((c) => c.source.href)).toEqual([
      "https://www.orpha.net/en/disease/detail/286",
      "https://omim.org/entry/130050",
      "https://meshb.nlm.nih.gov/record/ui?ui=D004535",
      "https://icd.who.int/browse10/2019/en#/Q79.6",
    ]);
  });

  it("drops malformed codes", () => {
    const card = buildConditionCard(
      input({ case: { diseaseName: "X", diseaseCodes: { orpha: "ORPHA:abc", omim: "13005", mesh: "Z12", icd10: "javascript:alert(1)" } } }),
    );
    expect(card.facts.filter((f) => f.kind === "code")).toEqual([]);
    expect(codeLink("orpha", "286")).toBe("https://www.orpha.net/en/disease/detail/286");
    expect(codeLink("icd10", "q79.6")).toBe("https://icd.who.int/browse10/2019/en#/Q79.6");
    expect(codeLink("icd10", "U07.1 ")).toBeNull();
    expect(codeLink("omim", "OMIM:130050")).toBe("https://omim.org/entry/130050");
  });

  it("shows prevalence only with its source, quoting the label and adding a plain reading", () => {
    const fact = buildConditionCard(input()).facts.find((f) => f.kind === "prevalence");
    expect(fact?.value).toBe("1-9 / 100 000");
    expect(fact?.plain).toBe("About 1 to 9 in every 100,000 people have it.");
    expect(fact?.source.href).toBe("https://www.orpha.net/en/disease/detail/286");
  });

  it("never shows a prevalence whose source is missing", () => {
    const card = buildConditionCard(input({ brief: brief({ prevalence: [{ label: "1-9 / 100 000", sourceId: "nope" }] }) }));
    expect(kinds(card)).not.toContain("prevalence");
  });

  it("quotes a label it cannot parse without inventing a plain reading", () => {
    const card = buildConditionCard(input({ brief: brief({ prevalence: [{ label: "Unknown", sourceId: "gard:1" }] }) }));
    const fact = card.facts.find((f) => f.kind === "prevalence");
    expect(fact?.value).toBe("Unknown");
    expect(fact?.plain).toBeUndefined();
    expect(fact?.source.href).toBe("https://rarediseases.info.nih.gov/diseases/1");
  });

  it("does not read a case count as a share of people", () => {
    const card = buildConditionCard(input({ brief: brief({ prevalence: [{ label: "<1 / 1 000 000", prevalenceType: "Cases/families", sourceId: "gard:1" }] }) }));
    expect(card.facts.find((f) => f.kind === "prevalence")?.plain).toBeUndefined();
  });

  it("counts kept and maybe experts and centers from the judge result, linked to the shortlist", () => {
    const card = buildConditionCard(input());
    const experts = card.facts.find((f) => f.kind === "experts");
    const centers = card.facts.find((f) => f.kind === "centers");
    expect(experts?.count).toBe(2);
    expect(centers?.count).toBe(1);
    expect(experts?.source.href).toBe(`/cases/${CASE_ID}/shortlist`);
  });

  it("shows the nearest kept expert's distance against the travel limit, linked to its evidence", () => {
    const near = buildConditionCard(input()).facts.find((f) => f.kind === "nearest");
    expect(near?.miles).toBe(420);
    expect(near?.travelLimitMiles).toBe(300);
    expect(near?.withinTravelLimit).toBe(false);
    expect(near?.source.href).toBe("https://example.org/near");
    expect(near?.plain).toContain("state to state");
  });

  it("handles judgements without travel facts and a missing judge result", () => {
    const noTravel = buildConditionCard(input({ judge: judge([judgement({})]) }));
    expect(kinds(noTravel)).not.toContain("nearest");
    const none = buildConditionCard(input({ judge: null }));
    expect(kinds(none)).toEqual(["name", "code", "code", "code", "code", "prevalence"]);
  });

  it("gives every fact a source link", () => {
    for (const fact of buildConditionCard(input()).facts) expect(fact.source.href).toMatch(/^(https:\/\/|\/cases\/)/);
  });

  it("for an undiagnosed case says No diagnosis yet and shows no codes or prevalence", () => {
    const card = buildConditionCard(
      input({ case: { diseaseName: "Undiagnosed condition", undiagnosed: true, diseaseCodes: { orpha: "286" } } }),
    );
    expect(card.undiagnosed).toBe(true);
    expect(card.facts.find((f) => f.kind === "name")?.value).toBe("No diagnosis yet");
    expect(kinds(card)).not.toContain("code");
    expect(kinds(card)).not.toContain("prevalence");
    expect(JSON.stringify(card)).not.toContain("Ehlers");
  });

  it("does not change its inputs", () => {
    const value = input();
    const before = JSON.stringify(value);
    buildConditionCard(value);
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("plainPrevalence", () => {
  it("reads clean Orphanet labels", () => {
    expect(plainPrevalence("1-5 / 10 000")).toBe("About 1 to 5 in every 10,000 people have it.");
    expect(plainPrevalence("<1 / 1 000 000")).toBe("Fewer than 1 in every 1,000,000 people have it.");
    expect(plainPrevalence(">1 / 1000")).toBe("More than 1 in every 1,000 people have it.");
    expect(plainPrevalence("1-9 / 100 000 (estimated)")).toBeNull();
    expect(plainPrevalence("9-1 / 100 000")).toBeNull();
  });
});

describe("nearestCare", () => {
  it("ignores dropped candidates and trials", () => {
    const result = judge([
      judgement({ verdict: "drop", travel: travel(5) }),
      judgement({ kind: "trial", travel: travel(6) }),
      judgement({ kind: "institution", travel: travel(80, 100) }),
    ]);
    expect(nearestCare(result)?.miles).toBe(80);
    expect(nearestCare(null)).toBeNull();
  });
});
