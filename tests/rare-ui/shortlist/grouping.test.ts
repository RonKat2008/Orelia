import { describe, expect, it } from "vitest";
import { groupOf, type ShortlistCard } from "@/components/shortlist/data";
import { GROUPS, eyebrowOf, expertCenterLabel, matchesFilters, NO_FILTERS, parseFilters } from "@/components/shortlist/view-model";
import { isGoodMatch, metaLine } from "@/components/patient/flows/shortlist/logic";
import { fleschKincaid } from "@/scripts/patient-readability";
import { RARE_TAG_LABELS } from "@/lib/rare-disease/tags";

const ev = (claimType: string) => ({
  claimType,
  claim: "c",
  sourceUrl: "https://example.org/x",
  sourceKind: "web",
  fetchedAt: "2026-10-23T12:00:00.000Z",
});

function card(resource: Record<string, unknown>, claimTypes: string[], tier?: ShortlistCard["tier"]): ShortlistCard {
  const evidence = claimTypes.map(ev);
  return {
    resource: { id: "r1", evidenceRefs: [], ...resource },
    score: 50,
    breakdown: [],
    evidence,
    group: groupOf({ id: "r1", evidenceRefs: [], ...resource } as never, evidence as never),
    tier,
  } as unknown as ShortlistCard;
}

const trial = (extra: Record<string, unknown> = {}) => ({ kind: "trial", title: "A study", nctId: "NCT00000001", ...extra });

describe("rare-disease shortlist grouping", () => {
  it("puts observational studies in Studies & registries", () => {
    expect(card(trial({ studyType: "observational" }), ["observational_study"]).group).toBe("studies");
    expect(card(trial(), ["observational_study"]).group).toBe("studies");
  });

  it("puts patient registries in Studies & registries", () => {
    expect(card({ kind: "organization", name: "Reg", organizationKind: "registry" }, ["patient_registry"]).group).toBe("studies");
    expect(card({ kind: "organization", name: "Reg", organizationKind: "registry" }, []).group).toBe("studies");
  });

  it("keeps interventional trials in Trials", () => {
    expect(card(trial({ studyType: "interventional" }), ["trial"]).group).toBe("trials");
    expect(card(trial(), []).group).toBe("trials");
  });

  it("lists Studies & registries as its own group and filter option", () => {
    const g = GROUPS.find((x) => x.id === "studies");
    expect(g?.title).toBe("Studies & registries");
    expect(parseFilters(new URLSearchParams("kind=studies")).kind).toBe("studies");
    const c = card(trial({ studyType: "observational" }), ["observational_study"]);
    expect(matchesFilters(c, { ...NO_FILTERS, kind: "trials" }, null)).toBe(false);
    expect(matchesFilters(c, { ...NO_FILTERS, kind: "studies" }, null)).toBe(true);
  });

  it("labels study and registry types in plain words", () => {
    const study = card(trial({ studyType: "observational" }), ["observational_study"]);
    const reg = card({ kind: "organization", name: "Reg", organizationKind: "registry" }, ["patient_registry"]);
    expect(eyebrowOf(study.resource, study.evidence)).toBe("Study that follows people over time");
    expect(eyebrowOf(reg.resource, reg.evidence)).toBe("Patient registry");
    const t = card(trial(), []);
    expect(eyebrowOf(t.resource, t.evidence)).toBe("Clinical trial");
  });
});

describe("expert center tag", () => {
  const inst = (claims: string[]) => card({ kind: "institution", name: "Clinic", city: "Boston", state: "MA" }, claims);

  it.each([
    ["nord_center_of_excellence", RARE_TAG_LABELS.nord_coe],
    ["rdcrn_consortium", RARE_TAG_LABELS.rdcrn],
    ["udn_intake", RARE_TAG_LABELS.udn],
  ])("tags %s", (claim, label) => {
    expect(expertCenterLabel(inst([claim]).evidence)).toBe(label);
  });

  it("does not tag other institutions", () => {
    expect(expertCenterLabel(inst(["designation", "medical_genetics_taxonomy"]).evidence)).toBeNull();
  });
});

describe("patient shortlist rows", () => {
  it("shows the expert-center label in the meta line, plain words", () => {
    const c = card({ kind: "institution", name: "Clinic", city: "Boston", state: "MA" }, ["nord_center_of_excellence"]);
    const meta = metaLine(c);
    expect(meta).toContain("Boston, MA");
    expect(meta).toContain(RARE_TAG_LABELS.nord_coe);
  });

  it("names studies and registries in plain words", () => {
    const study = card(trial({ studyType: "observational" }), ["observational_study"]);
    const reg = card({ kind: "organization", name: "Reg", organizationKind: "registry" }, ["patient_registry"]);
    expect(metaLine(study)).toMatch(/^Study that follows people over time/);
    expect(metaLine(reg)).toMatch(/^Patient registry/);
  });

  it("keeps to one badge: Good match is the only badge, the label stays in the meta line", () => {
    const c = card({ kind: "institution", name: "Clinic" }, ["udn_intake"], "best");
    expect(isGoodMatch(c, [])).toBe(true);
    expect(metaLine(c)).toContain(RARE_TAG_LABELS.udn);
  });

  it("meta copy reads at grade 8 or below", () => {
    const c = card({ kind: "institution", name: "Clinic", city: "Boston", state: "MA" }, ["rdcrn_consortium"]);
    const text = `${metaLine(c)}. ${RARE_TAG_LABELS.observational_study}. ${RARE_TAG_LABELS.registry}.`;
    expect(fleschKincaid([text]).grade).toBeLessThanOrEqual(8);
    expect(text).not.toMatch(/\b(agent|swarm|curator|verifier|allowlist|resource|score|rank|tier|pipeline)\b/i);
  });
});
