import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CareNeeds } from "@/lib/contracts/care-needs";
import { NeedsProfile } from "@/components/judge/NeedsProfile";
import { stepLabel } from "@/components/plan/model";

const base = {
  personal: { notes: [] },
  specialties: [],
  centerCapabilities: [],
  redFlags: [],
  trialEligibility: [],
  supportNeeds: [],
  questions: [],
  emergencyFacts: [{ id: "emer-1", text: "EMERGENCY FACT TEXT", plain: "x", evidenceIds: [] }],
  sources: [{ id: "a", url: "https://example.org/a", title: "Src", kind: "web", fetchedAt: "2026-10-23T12:00:00.000Z" }],
  elapsedMs: 1000,
  fromCache: false,
};
const render = (needs: unknown) => renderToStaticMarkup(createElement(NeedsProfile, { needs: needs as CareNeeds }));

describe("needs profile workup", () => {
  it("renders the diagnostic workup section when present", () => {
    const html = render({ ...base, workup: [{ id: "workup-1", text: "Exome sequencing at a genetics clinic", plain: "A test that reads many genes.", evidenceIds: ["a"] }] });
    expect(html).toContain("What to look for in a diagnostic workup");
    expect(html).toContain("Exome sequencing at a genetics clinic");
    expect(html).toContain("A test that reads many genes.");
  });

  it("omits the section when empty or missing (older cached analyses)", () => {
    expect(render({ ...base, workup: [] })).not.toContain("diagnostic workup");
    expect(render(base)).not.toContain("diagnostic workup");
  });

  it("never shows emergency facts in the judge profile", () => {
    expect(render({ ...base, workup: [] })).not.toContain("EMERGENCY FACT TEXT");
  });
});

describe("plan registry label", () => {
  it("shows registries as Join the registry", () => {
    expect(stepLabel({ purpose: "intro", channel: "web_form" }, { registry: true })).toBe("Join the registry by online form");
    expect(stepLabel({ purpose: "follow_up", channel: "email" }, { registry: true })).toBe("Follow up by email");
    expect(stepLabel({ purpose: "intro", channel: "email" })).toBe("Introduce by email");
  });
});
