import { describe, expect, it } from "vitest";
import type { Evidence, ResearchResult, Resource } from "@/lib/contracts";
import { verify, verifyWithProposals } from "@/lib/agents/verifier";

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (sourceUrl: string, claim = "claim", sourceKind: Evidence["sourceKind"] = "pubmed"): Evidence => ({
  claimType: "paper",
  claim,
  sourceUrl,
  sourceKind,
  fetchedAt: NOW,
});
const expert = (id: string, name: string, npi: string | null, refs: string[]): Resource => ({
  kind: "expert",
  id,
  name,
  npi,
  evidenceRefs: refs,
});
const ok = (records: Resource[], evidence: Evidence[]): ResearchResult => ({ status: "ok", records, evidence });

describe("verify", () => {
  it("drops evidence without a sourceUrl and records left with no evidence", () => {
    const bad = { claimType: "paper", claim: "no url", sourceKind: "pubmed", fetchedAt: NOW } as unknown as Evidence;
    const result = ok(
      [expert("a", "Ada Lovelace", null, ["0"]), expert("b", "Grace Hopper", null, ["https://x.org/p/1"])],
      [bad, ev("https://x.org/p/1")],
    );
    const out = verify([result]);
    expect(out.kept.map((k) => k.resource.kind === "expert" && k.resource.name)).toEqual(["Grace Hopper"]);
    expect(out.dropped.map((d) => d.type).sort()).toEqual(["evidence", "record"]);
    for (const k of out.kept) for (const e of k.evidence) expect(e.sourceUrl).toMatch(/^https?:\/\//);
  });

  it("drops a record whose refs resolve to nothing, and ignores error/not_implemented results", () => {
    const out = verify([
      ok([expert("a", "Ada", null, ["https://nowhere"])], [ev("https://x.org/1")]),
      { status: "error", message: "boom" },
      { status: "not_implemented" },
    ]);
    expect(out.kept).toHaveLength(0);
    expect(out.dropped).toHaveLength(1);
  });

  it("merges experts with the same NPI across agents and unions their evidence", () => {
    const a = ok([expert("lit:1", "Jane Roe", "1234567890", ["https://pm/1"])], [ev("https://pm/1")]);
    const b = ok(
      [expert("id:1", "Jane Roe", "1234567890", ["https://npi/1"])],
      [ev("https://npi/1", "NPI match", "nppes")],
    );
    const out = verify([a, b]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidence).toHaveLength(2);
    expect(out.merged).toEqual([expect.objectContaining({ key: "expert:npi:1234567890", mergedFromIds: ["lit:1", "id:1"] })]);
    expect(out.conflicts).toHaveLength(0);
  });

  it("flags same NPI with different names as a conflict", () => {
    const out = verify([
      ok([expert("1", "Jane Roe", "999", ["https://a/1"])], [ev("https://a/1")]),
      ok([expert("2", "John Doe", "999", ["https://b/1"])], [ev("https://b/1")]),
    ]);
    expect(out.kept).toHaveLength(1);
    expect(out.conflicts[0]!.reason).toMatch(/different names/);
  });

  it("merges trials by nctId, orgs by normalized URL, institutions by normalized name", () => {
    const trial = (id: string): Resource => ({ kind: "trial", id, nctId: "NCT01", title: "T", evidenceRefs: ["https://ct/1"] });
    const org = (id: string, url: string): Resource => ({ kind: "organization", id, name: "Fund", url, evidenceRefs: ["https://ct/1"] });
    const inst = (id: string, name: string): Resource => ({ kind: "institution", id, name, evidenceRefs: ["https://ct/1"] });
    const out = verify([
      ok([trial("t1"), org("o1", "https://www.fund.org/help/"), inst("i1", "The Mayo Clinic")], [ev("https://ct/1")]),
      ok([trial("t2"), org("o2", "http://fund.org/help"), inst("i2", "Mayo Clinic")], [ev("https://ct/1")]),
    ]);
    expect(out.kept).toHaveLength(3);
    expect(out.merged).toHaveLength(3);
  });

  it("remaps expert.institutionId to the canonical institution id", () => {
    const inst: Resource = { kind: "institution", id: "inst:mayo", name: "Mayo Clinic", evidenceRefs: ["https://n/1"] };
    const ex: Resource = { ...expert("e", "Jane Roe", "1", ["https://n/1"]), institutionId: "inst:mayo" } as Resource;
    const out = verify([ok([inst, ex], [ev("https://n/1", "c", "nci")])]);
    const i = out.kept.find((k) => k.resource.kind === "institution")!;
    const e = out.kept.find((k) => k.resource.kind === "expert")!;
    expect(e.resource.kind === "expert" && e.resource.institutionId).toBe(i.resource.id);
  });

  it("is deterministic", () => {
    const r = ok([expert("a", "Ada", "1", ["https://a/1"])], [ev("https://a/1")]);
    expect(verify([r])).toEqual(verify([r]));
  });
});

describe("verifyWithProposals", () => {
  const results = [
    ok(
      [expert("1", "Jane Roe", null, ["https://a/1"]), expert("2", "J. Roe", null, ["https://b/1"])],
      [ev("https://a/1"), ev("https://b/1")],
    ),
  ];

  it("applies a proposed merge of existing records without inventing evidence", async () => {
    const base = verify(results);
    const urls = new Set(base.kept.flatMap((k) => k.evidence.map((e) => e.sourceUrl)));
    const out = await verifyWithProposals(results, async (kept) => ({
      merges: [{ keys: [kept[0]!.key, kept[1]!.key], reason: "same person" }],
      conflicts: [{ key: "nonexistent", reason: "ignored" }],
    }));
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.evidence.every((e) => urls.has(e.sourceUrl))).toBe(true);
    expect(out.conflicts).toHaveLength(0);
  });

  it("without a proposer equals the deterministic result", async () => {
    expect(await verifyWithProposals(results)).toEqual(verify(results));
  });
});
