import { describe, expect, it } from "vitest";
import { assessAdultScope } from "../../lib/agents/pediatric-scope";
import type { Evidence } from "../../lib/contracts";
import { verify } from "../../lib/agents/verifier";

describe("assessAdultScope", () => {
  it.each([
    "Seattle Children's Hospital",
    "Seattle Children’s Cardiac Genetics Program",
    "Childrens Hospital of Philadelphia",
    "Pediatric Cardiology Center",
    "Paediatric Rare Disease Clinic",
  ])("excludes a children's institution: %s", (name) => {
    const v = assessAdultScope({ name });
    expect(v.keep).toBe(false);
    expect(v.reason).toMatch(/children|pediatric/i);
  });

  it.each([
    "Mayo Clinic",
    "Adult and Pediatric Genetics Clinic",
    "Cardiac Genetics for Adults and Children",
    "Stanford Health Care",
  ])("keeps adult or mixed-scope resources: %s", (name) => {
    expect(assessAdultScope({ name }).keep).toBe(true);
  });

  it("keeps a children's-named program whose evidence states it serves adults", () => {
    const v = assessAdultScope({ name: "Children's Hospital Heart Center", texts: ["Adult congenital heart disease program"] });
    expect(v.keep).toBe(true);
  });

  it("does not exclude on a mere mention in evidence text", () => {
    expect(assessAdultScope({ name: "Mayo Clinic", texts: ["Also partners with a children's hospital"] }).keep).toBe(true);
  });

  it("checks an expert's specialty", () => {
    expect(assessAdultScope({ name: "Dr. Lee", specialty: "Pediatric cardiology" }).keep).toBe(false);
    expect(assessAdultScope({ name: "Dr. Lee", specialty: "Adult and pediatric cardiology" }).keep).toBe(true);
  });
});

describe("verify adult scope", () => {
  it("drops a children's institution with a human-readable reason and keeps adult ones", () => {
    const ev = (sourceUrl: string): Evidence => ({
      claimType: "other",
      claim: "Cardiac genetics program",
      sourceUrl,
      sourceKind: "exa",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    const out = verify([
      {
        status: "ok",
        records: [
          { kind: "institution", id: "a", name: "Seattle Children's Hospital", evidenceRefs: ["https://example.org/a"] },
          { kind: "institution", id: "b", name: "University of Washington Medical Center", evidenceRefs: ["https://example.org/b"] },
        ],
        evidence: [ev("https://example.org/a"), ev("https://example.org/b")],
      },
    ]);
    expect(out.kept.map((k) => (k.resource.kind === "institution" ? k.resource.name : ""))).toEqual(["University of Washington Medical Center"]);
    expect(out.dropped.some((d) => d.type === "record" && /children's|pediatric/i.test(d.reason) && /adult/i.test(d.reason))).toBe(true);
  });
});
