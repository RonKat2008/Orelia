import { describe, expect, it } from "vitest";
import type { Evidence, ResearchResult, Resource } from "@/lib/contracts";
import { verify } from "@/lib/agents/verifier";

const NOW = "2026-01-01T00:00:00.000Z";
const ev = (sourceUrl: string, claim: string): Evidence => ({ claimType: "org_program", claim, sourceUrl, sourceKind: "exa", fetchedAt: NOW });
const org = (id: string, name: string, url: string | undefined, ref: string): Resource =>
  ({ kind: "organization", id, name, organizationKind: "advocacy", ...(url ? { url } : {}), evidenceRefs: [ref] }) as Resource;
const ok = (records: Resource[], evidence: Evidence[]): ResearchResult => ({ status: "ok", records, evidence });

describe("verify: organization dedupe by normalised name + domain", () => {
  it("merges the same organization reported at two paths of one domain", () => {
    const out = verify([
      ok([org("a", "Sarcoma Alliance", "https://sarcomaalliance.org/", "https://sarcomaalliance.org/")], [ev("https://sarcomaalliance.org/", "Peer support")]),
      ok([org("b", "The Sarcoma Alliance", "https://www.sarcomaalliance.org/support", "https://www.sarcomaalliance.org/support")], [ev("https://www.sarcomaalliance.org/support", "Second opinion assistance")]),
    ]);
    const orgs = out.kept.filter((k) => k.resource.kind === "organization");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.evidence.map((e) => e.claim).sort()).toEqual(["Peer support", "Second opinion assistance"]);
    expect(out.merged.some((m) => m.mergedFromIds.includes("a") && m.mergedFromIds.includes("b"))).toBe(true);
  });

  it("merges a same-name record without a URL into the one with a URL", () => {
    const out = verify([
      ok([org("a", "Sarcoma Alliance", "https://sarcomaalliance.org/", "https://sarcomaalliance.org/")], [ev("https://sarcomaalliance.org/", "Peer support")]),
      ok([org("b", "Sarcoma Alliance", undefined, "https://news.example.org/a")], [ev("https://news.example.org/a", "Mentioned")]),
    ]);
    expect(out.kept.filter((k) => k.resource.kind === "organization")).toHaveLength(1);
  });

  it("keeps same-name organizations on different domains separate", () => {
    const out = verify([
      ok([org("a", "Sarcoma Alliance", "https://sarcomaalliance.org/", "https://sarcomaalliance.org/")], [ev("https://sarcomaalliance.org/", "Peer support")]),
      ok([org("b", "Sarcoma Alliance", "https://sarcoma-alliance.example.net/", "https://sarcoma-alliance.example.net/")], [ev("https://sarcoma-alliance.example.net/", "Other group")]),
    ]);
    expect(out.kept.filter((k) => k.resource.kind === "organization")).toHaveLength(2);
  });

  it("keeps different organizations on one domain separate", () => {
    const out = verify([
      ok([
        org("a", "Travel Grant Program", "https://fund.example.org/travel", "https://fund.example.org/travel"),
        org("b", "Copay Assistance", "https://fund.example.org/copay", "https://fund.example.org/copay"),
      ], [ev("https://fund.example.org/travel", "Travel"), ev("https://fund.example.org/copay", "Copay")]),
    ]);
    expect(out.kept.filter((k) => k.resource.kind === "organization")).toHaveLength(2);
  });
});
