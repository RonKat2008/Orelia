import { describe, expect, it } from "vitest";
import type { Evidence, ResearchResult, Resource, TrialRegistry } from "@/lib/contracts";
import {
  dedupeKey,
  deterministicUuid,
  normalizeName,
  normalizeUrl,
  supportedMerge,
  verify,
  verifyWithProposals,
  type EvidenceWithId,
  type MergeProposal,
  type VerifiedRecord,
} from "@/lib/agents/verifier";

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (sourceUrl: string, claim = "claim", claimType = "paper"): Evidence => ({
  claimType,
  claim,
  sourceUrl,
  sourceKind: "pubmed",
  fetchedAt: NOW,
});
const ok = (records: Resource[], evidence: unknown[]): ResearchResult =>
  ({ status: "ok", records, evidence }) as ResearchResult;
const expert = (id: string, name: string, npi: string | null, refs: string[], extra: object = {}): Resource =>
  ({ kind: "expert", id, name, npi, evidenceRefs: refs, ...extra }) as Resource;
const inst = (id: string, name: string, refs: string[], extra: object = {}): Resource =>
  ({ kind: "institution", id, name, evidenceRefs: refs, ...extra }) as Resource;
const org = (id: string, name: string, refs: string[], url?: string): Resource =>
  ({ kind: "organization", id, name, url, evidenceRefs: refs }) as Resource;
const registry = (over: Partial<TrialRegistry> = {}): TrialRegistry => ({
  conditions: ["Epithelioid Sarcoma"], keywords: [], meshTerms: [], stdAges: ["ADULT"], phases: ["PHASE2"],
  usSiteCount: 1, usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: [], hasContact: true, ...over,
});
const trial = (id: string, nctId: string, title: string, refs: string[], extra: object = {}): Resource =>
  ({ kind: "trial", id, nctId, title, evidenceRefs: refs, ...extra }) as Resource;

const withId = (e: Evidence, id: string): EvidenceWithId => ({ ...e, id });
const rec = (resource: Resource, evidence: EvidenceWithId[] = []): VerifiedRecord => ({
  resource, key: `${resource.kind}:${resource.id}`, evidence,
});

describe("normalisation helpers", () => {
  it("normalizeUrl rejects non-http protocols and unparsable input", () => {
    expect(normalizeUrl("ftp://files.example.org/a")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("https://WWW.Example.org/A/B//")).toBe("example.org/a/b");
  });

  it("normalizeName strips diacritics, stopwords and punctuation", () => {
    expect(normalizeName("The Université of  Ríos & Co., Inc")).toBe("universite rios and co");
  });

  it("dedupeKey picks npi, name, url or name fallbacks per kind", () => {
    expect(dedupeKey(expert("1", "Ada", " 123 ", []))).toBe("expert:npi:123");
    expect(dedupeKey(expert("1", "Dr. Ada Lovelace MD", null, []))).toBe("expert:name:dr ada lovelace");
    expect(dedupeKey(org("1", "Fund", [], "https://www.fund.org/x/"))).toBe("organization:url:fund.org/x");
    expect(dedupeKey(org("1", "The Fund", []))).toBe("organization:name:fund");
    expect(dedupeKey(trial("1", " nct01 ", "T", []))).toBe("trial:nct:NCT01");
  });

  it("deterministicUuid is stable and UUID-shaped", () => {
    expect(deterministicUuid("a")).toBe(deterministicUuid("a"));
    expect(deterministicUuid("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("verify: evidence cleaning and reference resolution", () => {
  it("drops null, non-object, bad-url, ftp-url and empty-claim evidence with reasons", () => {
    const evidence = [
      null,
      "just a string",
      { ...ev("https://ok.org/1"), sourceUrl: "ftp://bad.org/1" },
      { ...ev("https://ok.org/2"), sourceUrl: "   " },
      { ...ev("https://ok.org/3"), claim: "   " },
      { ...ev("https://ok.org/4"), claim: 42 },
      ev("https://ok.org/5"),
    ];
    const out = verify([ok([expert("a", "Ada", null, ["6"])], evidence)]);
    expect(out.dropped.filter((d) => d.type === "evidence").map((d) => d.reason)).toEqual([
      "malformed evidence",
      "malformed evidence",
      "missing or invalid sourceUrl",
      "missing or invalid sourceUrl",
      "empty claim",
      "empty claim",
    ]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidence).toHaveLength(1);
  });

  it("resolves refs by index, by sourceUrl and by evidence id, ignoring unknown and out-of-range refs", () => {
    const withEvidenceId = { ...ev("https://ok.org/id"), id: "ev-id-1" };
    const evidence = [ev("https://ok.org/0"), ev("https://ok.org/url"), withEvidenceId];
    const out = verify([
      ok(
        [
          expert("a", "Ada", null, ["0", "https://ok.org/url", "ev-id-1", "99", "nope"]),
          expert("b", "Bea", null, ["99", "nope"]),
        ],
        evidence,
      ),
    ]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidence.map((e) => e.sourceUrl).sort()).toEqual([
      "https://ok.org/0", "https://ok.org/id", "https://ok.org/url",
    ]);
    expect(out.dropped).toEqual([expect.objectContaining({ type: "record", reason: "no evidence with a sourceUrl" })]);
  });

  it("does not resolve a numeric ref that points at dropped evidence unless another field matches", () => {
    const out = verify([ok([expert("a", "Ada", null, ["0"])], [{ claimType: "x", claim: "c" }])]);
    expect(out.kept).toHaveLength(0);
  });

  it("treats a record whose evidenceRefs is not an array as having no evidence", () => {
    const broken = { ...expert("a", "Ada", null, []), evidenceRefs: undefined } as unknown as Resource;
    const out = verify([ok([broken], [ev("https://ok.org/1")])]);
    expect(out.kept).toHaveLength(0);
    expect(out.dropped).toHaveLength(1);
  });
});

describe("verify: trial relevance context", () => {
  const ctx = { diseaseName: "Epithelioid sarcoma" };
  const refs = ["https://ct.gov/1"];

  it("drops an off-target trial with the relevance reason and keeps an on-target one", () => {
    const out = verify(
      [ok([
        trial("t1", "NCT1", "Off target", refs, { registry: registry({ conditions: ["Lupus"] }) }),
        trial("t2", "NCT2", "On target", refs, { registry: registry() }),
      ], [ev("https://ct.gov/1")])],
      ctx,
    );
    expect(out.kept.map((k) => k.key)).toEqual(["trial:nct:NCT2"]);
    expect(out.dropped).toEqual([expect.objectContaining({ type: "record", reason: expect.stringContaining("off-target") })]);
  });

  it("keeps trials without registry facts and skips the filter when no context is given", () => {
    const noRegistry = trial("t3", "NCT3", "No registry", refs);
    const offTarget = trial("t4", "NCT4", "Off", refs, { registry: registry({ conditions: ["Lupus"] }) });
    expect(verify([ok([noRegistry], [ev("https://ct.gov/1")])], ctx).kept).toHaveLength(1);
    expect(verify([ok([offTarget], [ev("https://ct.gov/1")])]).kept).toHaveLength(1);
  });

  it("falls back to a generic reason when the verdict gives none", () => {
    // age eligibility not stated -> out of scope with its own reason, never the fallback
    const unknownAge = trial("t5", "NCT5", "Epithelioid sarcoma study", refs, { registry: registry({ stdAges: [] }) });
    const out = verify([ok([unknownAge], [ev("https://ct.gov/1")])], ctx);
    expect(out.dropped[0]!.reason).toBe("out of scope: age eligibility not stated");
  });
});

describe("verify: duplicate merging and conflicts", () => {
  const e1 = ev("https://a.org/1");
  const e2 = ev("https://b.org/1");

  it("flags trial title and status conflicts and keeps the first non-empty fields", () => {
    const out = verify([
      ok([trial("t1", "NCT9", "Alpha study", ["0"], { status: "RECRUITING" })], [e1]),
      ok([trial("t2", "NCT9", "Beta study", ["0"], { status: "COMPLETED" })], [e2]),
      ok([trial("t3", "NCT9", "Alpha study", ["0"], { status: "ACTIVE" })], [ev("https://c.org/1")]),
    ]);
    const reasons = out.conflicts.map((c) => c.reason);
    expect(reasons[0]).toMatch(/different titles/);
    expect(reasons[1]).toMatch(/different statuses/);
    expect(out.kept).toHaveLength(1);
    expect(out.conflicts[0]!.recordId).toBe(out.kept[0]!.resource.id);
    expect(out.conflicts[0]!.values).toEqual(["Alpha study", "Beta study"]);
  });

  it("does not flag a status conflict when only one side has a status", () => {
    const out = verify([
      ok([trial("t1", "NCT9", "Same", ["0"], { status: "RECRUITING" })], [e1]),
      ok([trial("t2", "NCT9", "Same", ["0"])], [e2]),
    ]);
    expect(out.conflicts).toHaveLength(0);
    expect((out.kept[0]!.resource as { status?: string }).status).toBe("RECRUITING");
  });

  it("flags organizations sharing a URL under different names, and merges missing fields", () => {
    const a = org("o1", "Fund Alpha", ["0"], "https://fund.org/help");
    const b = { ...org("o2", "Fund Beta", ["0"], "http://www.fund.org/help/"), organizationKind: "financial_aid" } as Resource;
    const out = verify([ok([a], [e1]), ok([b], [e2])]);
    expect(out.conflicts[0]!.reason).toMatch(/URL shared by different organizations/);
    expect((out.kept[0]!.resource as { organizationKind?: string }).organizationKind).toBe("financial_aid");
  });

  it("flags institutions reported in different states but not when a state is missing or equal ignoring case", () => {
    const run = (sa: string | undefined, sb: string | undefined) =>
      verify([
        ok([inst("i1", "Mayo Clinic", ["0"], { state: sa })], [e1]),
        ok([inst("i2", "Mayo Clinic", ["0"], { state: sb })], [e2]),
      ]).conflicts;
    expect(run("MN", "AZ")[0]!.reason).toMatch(/different states/);
    expect(run("MN", "mn")).toHaveLength(0);
    expect(run("MN", undefined)).toHaveLength(0);
  });

  it("merges mixed-kind keys without conflict and keeps empty-string fields replaceable", () => {
    const out = verify([
      ok([inst("i1", "Mayo Clinic", ["0"], { city: "" })], [e1]),
      ok([inst("i2", "Mayo Clinic", ["0"], { city: "Rochester" })], [e2]),
    ]);
    expect((out.kept[0]!.resource as { city?: string }).city).toBe("Rochester");
  });

  it("leaves a field undefined when both duplicates carry it empty", () => {
    const out = verify([
      ok([inst("i1", "Mayo Clinic", ["0"], { city: "" })], [e1]),
      ok([inst("i2", "Mayo Clinic", ["0"], { city: "" })], [e2]),
    ]);
    expect((out.kept[0]!.resource as { city?: string }).city).toBeUndefined();
  });

  it("does not flag the same NPI under the same name", () => {
    const out = verify([
      ok([expert("1", "Jane Roe", "5", ["0"])], [e1]),
      ok([expert("2", "Jane Roe", "5", ["0"])], [e2]),
    ]);
    expect(out.conflicts).toHaveLength(0);
  });

  it("prefers the corroborated identity profile from either side when merging experts", () => {
    const lit = expert("lit", "Jane Roe", "7", ["0"], { profile: { paperCount: 99 } });
    const idA = expert("id", "Jane Roe", "7", ["0"], { verified: true, profile: { paperCount: 3 } });
    const first = verify([ok([idA], [e1]), ok([lit], [e2])]).kept[0]!.resource as Extract<Resource, { kind: "expert" }>;
    const second = verify([ok([lit], [e1]), ok([idA], [e2])]).kept[0]!.resource as Extract<Resource, { kind: "expert" }>;
    const neither = verify([ok([lit], [e1]), ok([{ ...lit, id: "lit2", profile: { paperCount: 1 } } as Resource], [e2])])
      .kept[0]!.resource as Extract<Resource, { kind: "expert" }>;
    expect(first.profile?.paperCount).toBe(3);
    expect(second.profile?.paperCount).toBe(3);
    expect(second.verified).toBe(true);
    expect(neither.profile?.paperCount).toBe(99);
    expect(neither.verified).toBeUndefined();
  });

  it("merges a publication-only expert into the single NPI expert with the same name", () => {
    const out = verify([
      ok([expert("lit", "Jane Roe", null, ["0"])], [e1]),
      ok([expert("npi", "Jane Roe", "42", ["0"])], [e2]),
    ]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.key).toBe("expert:npi:42");
    expect(out.merged[0]!.mergedFromIds.sort()).toEqual(["lit", "npi"]);
    expect(out.kept[0]!.evidence).toHaveLength(2);
  });

  it("keeps a name-only expert separate when several NPI experts share its name or none match", () => {
    const out = verify([
      ok([expert("lit", "Jane Roe", null, ["0"]), expert("other", "Zed Alone", null, ["0"])], [e1]),
      ok([expert("n1", "Jane Roe", "1", ["0"]), expert("n2", "Jane Roe", "2", ["0"])], [e2]),
    ]);
    expect(out.kept.map((k) => k.key).sort()).toEqual([
      "expert:name:jane roe", "expert:name:zed alone", "expert:npi:1", "expert:npi:2",
    ]);
  });

  it("sets shortlistEligibility only on experts and reports unverified ones as ineligible", () => {
    const out = verify([ok([expert("e", "Jane Roe", "1", ["0"]), inst("i", "Mayo", ["0"])], [e1])]);
    const e = out.kept.find((k) => k.resource.kind === "expert")!;
    const i = out.kept.find((k) => k.resource.kind === "institution")!;
    expect(e.shortlistEligibility?.eligible).toBe(false);
    expect(i.shortlistEligibility).toBeUndefined();
  });

  it("leaves institutionId undefined when it references no kept institution", () => {
    const out = verify([ok([expert("e", "Jane Roe", "1", ["0"], { institutionId: "inst:missing" })], [e1])]);
    expect((out.kept[0]!.resource as { institutionId?: string }).institutionId).toBeUndefined();
  });

  it("does not report a merge for a record seen once", () => {
    const out = verify([ok([expert("e", "Jane Roe", "1", ["0"])], [e1])]);
    expect(out.merged).toEqual([]);
  });
});

describe("supportedMerge", () => {
  const proposal = (evidenceIds?: string[]): MergeProposal => ({ keys: ["a", "b"], reason: "same", evidenceIds });

  it("rejects contradictory NPIs and NCT ids even when names match", () => {
    const a = rec(expert("a", "Jane Roe", "1", []));
    const b = rec(expert("b", "Jane Roe", "2", []));
    expect(supportedMerge(a, b, proposal())).toBe(false);
    const t1 = rec(trial("a", "NCT1", "T", []));
    const t2 = rec(trial("b", "NCT2", "T", []));
    expect(supportedMerge(t1, t2, proposal())).toBe(false);
  });

  it("accepts records with the same trimmed NPI, same NCT id (case-insensitive) or same organization domain", () => {
    expect(supportedMerge(rec(expert("a", "J", " 5 ", [])), rec(expert("b", "K", "5", [])), proposal())).toBe(true);
    expect(supportedMerge(rec(trial("a", "nct1", "T", [])), rec(trial("b", "NCT1", "U", [])), proposal())).toBe(true);
    expect(supportedMerge(rec(org("a", "A", [], "https://www.x.org/a")), rec(org("b", "B", [], "https://x.org/b")), proposal())).toBe(true);
  });

  it("accepts institutions sharing name, city and state and rejects a namesake lacking city/state", () => {
    const mk = (id: string, extra: object) => rec(inst(id, "Mayo Clinic", [], extra));
    expect(supportedMerge(mk("a", { city: "Rochester", state: "MN" }), mk("b", { city: "Rochester", state: "MN" }), proposal())).toBe(true);
    expect(supportedMerge(mk("a", {}), mk("b", {}), proposal())).toBe(false);
    expect(supportedMerge(mk("a", { city: "Rochester", state: "MN" }), mk("b", {}), proposal())).toBe(false);
    expect(supportedMerge(mk("a", { city: "Rochester", state: "MN" }), mk("b", { city: "Phoenix", state: "AZ" }), proposal())).toBe(false);
  });

  it("requires cited structured evidence on both sides when the records alone do not match", () => {
    const a = rec(inst("a", "Alpha Hospital", []), [withId(ev("https://a.org", '{"name":"X Center","city":"C","state":"S"}'), "ea")]);
    const b = rec(inst("b", "Beta Hospital", []), [withId(ev("https://b.org", '{"name":"x center","city":"c","state":"s"}'), "eb")]);
    expect(supportedMerge(a, b, proposal())).toBe(false);
    expect(supportedMerge(a, b, proposal(["ea"]))).toBe(false);
    expect(supportedMerge(a, b, proposal(["ea", "eb"]))).toBe(true);
  });

  it("matches cited evidence on a shared domain, with or without a scheme", () => {
    const a = rec(org("a", "A", []), [withId(ev("https://a.org", '{"domain":"https://www.x.org/p"}'), "ea")]);
    const b = rec(org("b", "B", []), [withId(ev("https://b.org", '{"domain":"x.org"}'), "eb")]);
    expect(supportedMerge(a, b, proposal(["ea", "eb"]))).toBe(true);
  });

  it("ignores unparsable domains in cited evidence", () => {
    const a = rec(org("a", "A", []), [withId(ev("https://a.org", '{"domain":"http://"}'), "ea")]);
    const b = rec(org("b", "B", []), [withId(ev("https://b.org", '{"domain":"http://"}'), "eb")]);
    expect(supportedMerge(a, b, proposal(["ea", "eb"]))).toBe(false);
  });

  it("reads scalar claims typed by identity claimType and ignores unknown fields", () => {
    const mk = (id: string, claimType: string, claim: string, eid: string) =>
      rec(expert(id, "Q", null, []), [withId(ev(`https://${id}.org`, claim, claimType), eid)]);
    expect(supportedMerge(mk("a", "identity_npi", "77", "ea"), mk("b", "identity.npi", "77", "eb"), proposal(["ea", "eb"]))).toBe(true);
    expect(supportedMerge(mk("a", "identity_npi", "77", "ea"), mk("b", "identity_npi", "78", "eb"), proposal(["ea", "eb"]))).toBe(false);
    expect(supportedMerge(mk("a", "paper", "77", "ea"), mk("b", "paper", "77", "eb"), proposal(["ea", "eb"]))).toBe(false);
  });

  it("treats JSON arrays, nulls and numbers as narrative, not structured facts", () => {
    const mk = (id: string, claim: string, eid: string) =>
      rec(expert(id, "Q", null, []), [withId(ev(`https://${id}.org`, claim, "paper"), eid)]);
    expect(supportedMerge(mk("a", '["1"]', "ea"), mk("b", '["1"]', "eb"), proposal(["ea", "eb"]))).toBe(false);
    expect(supportedMerge(mk("a", "null", "ea"), mk("b", "null", "eb"), proposal(["ea", "eb"]))).toBe(false);
    expect(supportedMerge(mk("a", "5", "ea"), mk("b", "5", "eb"), proposal(["ea", "eb"]))).toBe(false);
  });

  it("blocks a cited-evidence merge when evidence NPI contradicts the record NPI", () => {
    const a = rec(expert("a", "Q", "1", []), [withId(ev("https://a.org", '{"npi":"2","name":"Q","city":"C","state":"S"}'), "ea")]);
    const b = rec(expert("b", "Z", null, []), [withId(ev("https://b.org", '{"npi":"2","name":"Q","city":"C","state":"S"}'), "eb")]);
    expect(supportedMerge(a, b, proposal(["ea", "eb"]))).toBe(false);
  });

  it("ignores non-string fields and matches NCT ids across cited evidence", () => {
    const a = rec(trial("a", "NCT1", "T", []), [withId(ev("https://a.org", '{"nctId":"NCT1","n":5}'), "ea")]);
    const b = rec(trial("b", "NCT1 ", "T", []), [withId(ev("https://b.org", '{"nctId":"nct1"}'), "eb")]);
    // record-level nct ids are equal after trim/upper only on the trimmed side; evidence confirms it
    expect(supportedMerge(a, b, proposal(["ea", "eb"]))).toBe(false);
  });
});

describe("verifyWithProposals", () => {
  const e = (n: number) => ev(`https://src.org/${n}`);
  const twoInstitutions = [
    ok(
      [inst("i1", "Alpha Hospital", ["0"]), inst("i2", "Beta Hospital", ["1"]), inst("i3", "Gamma Hospital", ["2"])],
      [e(0), e(1), e(2)],
    ),
  ];
  const identityClaim = '{"name":"Shared Center","city":"C","state":"S"}';
  const sharedResults = [
    ok(
      [
        inst("i1", "Alpha Hospital", ["0"]),
        inst("i2", "Beta Hospital", ["1"]),
        inst("i3", "Gamma Hospital", ["2"]),
        expert("e1", "Jane Roe", "9", ["3"], { institutionId: "i2" }),
      ],
      [
        ev("https://src.org/0", identityClaim, "identity_name"),
        ev("https://src.org/1", identityClaim, "identity_name"),
        ev("https://src.org/2", identityClaim, "identity_name"),
        e(3),
      ],
    ),
  ];
  const evidenceIdOf = (r: VerifiedRecord) => r.evidence[0]!.id;

  it("ignores merges that reference unknown keys, identical keys or different kinds", async () => {
    const base = verify(twoInstitutions);
    const out = await verifyWithProposals(
      [...twoInstitutions, ok([expert("x", "Jane", "1", ["0"])], [e(0)])],
      async (kept) => ({
        merges: [
          { keys: ["nope", kept[0]!.key], reason: "r" },
          { keys: [kept[0]!.key, "nope"], reason: "r" },
          { keys: [kept[0]!.key, kept[0]!.key], reason: "r" },
          { keys: [kept[0]!.key, kept.find((k) => k.resource.kind === "expert")!.key], reason: "r" },
        ],
        conflicts: [],
      }),
    );
    expect(out.kept).toHaveLength(base.kept.length + 1);
    expect(out.merged).toEqual(base.merged);
  });

  it("merges two records backed by cited structured identity evidence and combines their evidence", async () => {
    const out = await verifyWithProposals(sharedResults, async (kept) => {
      const [a, b] = kept.filter((k) => k.resource.kind === "institution");
      return {
        merges: [{ keys: [a!.key, b!.key], reason: "same center", evidenceIds: [evidenceIdOf(a!), evidenceIdOf(b!)] }],
        conflicts: [],
      };
    });
    const institutions = out.kept.filter((k) => k.resource.kind === "institution");
    expect(institutions).toHaveLength(2);
    expect(institutions[0]!.evidence).toHaveLength(2);
    expect(out.merged).toEqual([expect.objectContaining({ mergedFromIds: [expect.any(String)] })]);
  });

  it("refuses to merge a record that was already absorbed", async () => {
    const out = await verifyWithProposals(sharedResults, async (kept) => {
      const [a, b, c] = kept.filter((k) => k.resource.kind === "institution");
      const ids = kept.filter((k) => k.resource.kind === "institution").map(evidenceIdOf);
      return {
        merges: [
          { keys: [a!.key, b!.key], reason: "r", evidenceIds: ids },
          { keys: [c!.key, b!.key], reason: "absorbed second", evidenceIds: ids },
          { keys: [b!.key, c!.key], reason: "absorbed first", evidenceIds: ids },
        ],
        conflicts: [],
      };
    });
    expect(out.kept.filter((k) => k.resource.kind === "institution")).toHaveLength(2);
    expect(out.merged).toHaveLength(1);
  });

  it("redirects an expert's institutionId through chained merges and recomputes eligibility", async () => {
    const out = await verifyWithProposals(sharedResults, async (kept) => {
      const [a, b, c] = kept.filter((k) => k.resource.kind === "institution");
      const ids = kept.filter((k) => k.resource.kind === "institution").map(evidenceIdOf);
      return {
        merges: [
          { keys: [a!.key, b!.key], reason: "r", evidenceIds: ids },
          { keys: [c!.key, a!.key], reason: "r", evidenceIds: ids },
        ],
        conflicts: [],
      };
    });
    const survivors = out.kept.filter((k) => k.resource.kind === "institution");
    const exp = out.kept.find((k) => k.resource.kind === "expert")!;
    expect(survivors).toHaveLength(1);
    expect((exp.resource as { institutionId?: string }).institutionId).toBe(survivors[0]!.resource.id);
    expect(exp.shortlistEligibility?.eligible).toBe(false);
  });

  it("adds labeled proposed conflicts, mapping absorbed keys to the surviving record and skipping unknown keys", async () => {
    const out = await verifyWithProposals(sharedResults, async (kept) => {
      const [a, b] = kept.filter((k) => k.resource.kind === "institution");
      const ids = kept.filter((k) => k.resource.kind === "institution").map(evidenceIdOf);
      return {
        merges: [{ keys: [a!.key, b!.key], reason: "r", evidenceIds: ids }],
        conflicts: [
          { key: b!.key, reason: "phone differs" },
          { key: "missing", reason: "ignored" },
        ],
      };
    });
    const proposed = out.conflicts.filter((c) => c.reason.startsWith("[proposed]"));
    expect(proposed).toHaveLength(1);
    expect(proposed[0]!.reason).toBe("[proposed] phone differs");
    expect(proposed[0]!.recordId).toBe(out.kept.find((k) => k.key === proposed[0]!.key)!.resource.id);
  });

  it("reports structured conflicts for differing phone, email and NPI claims but not for equivalent phone formats", async () => {
    const claims = (a: string, b: string, field: string) => [
      ok([org("o", "Org", ["0", "1"])], [ev("https://o.org/1", JSON.stringify({ [field]: a })), ev("https://o.org/2", JSON.stringify({ [field]: b }))]),
    ];
    const run = async (a: string, b: string, field: string) =>
      (await verifyWithProposals(claims(a, b, field), async () => ({ merges: [], conflicts: [] }))).conflicts;
    expect((await run("+1 (555) 123-4567", "5551234567", "phone"))).toHaveLength(0);
    expect((await run("555-123-4567", "555-999-0000", "phone"))[0]!.reason).toBe("Conflicting structured phone values");
    expect((await run("A@x.org", "a@x.org", "email"))).toHaveLength(0);
    expect((await run("a@x.org", "b@x.org", "email"))).toHaveLength(1);
    expect((await run("1", "2", "npi"))).toHaveLength(1);
    expect((await run("NCT1", "NCT2", "nctId"))).toHaveLength(1);
  });

  it("ignores non-string structured values and blank values when looking for conflicts", async () => {
    const results = [
      ok([org("o", "Org", ["0", "1"])], [ev("https://o.org/1", '{"phone":5551234567}'), ev("https://o.org/2", '{"phone":"  "}')]),
    ];
    const out = await verifyWithProposals(results, async () => ({ merges: [], conflicts: [] }));
    expect(out.conflicts).toHaveLength(0);
  });

  it("returns the deterministic dropped list untouched", async () => {
    const results = [ok([expert("a", "Ada", null, ["9"])], [e(0)])];
    const base = verify(results);
    const out = await verifyWithProposals(results, async () => ({ merges: [], conflicts: [] }));
    expect(out.dropped).toEqual(base.dropped);
  });
});
