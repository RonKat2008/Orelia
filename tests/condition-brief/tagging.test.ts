import { describe, expect, it } from "vitest";
import { capLevel, designCeiling, LEVEL_ORDER, sourcesCeiling } from "@/lib/condition-brief/tagging";

describe("condition brief tagging policy", () => {
  it("orders levels weakest to strongest", () => {
    expect(LEVEL_ORDER).toEqual(["uncertain", "emerging", "established"]);
  });

  it.each([
    ["guideline", "established"], ["consensus", "established"], ["systematic_review", "established"],
    ["meta_analysis", "established"], ["genereviews", "established"], ["reference_page", "established"],
    ["narrative_review", "emerging"], ["primary_study", "emerging"], ["preprint", "emerging"], ["trial_early", "emerging"],
    ["trial_late", "emerging"], ["grant", "emerging"], ["registry", "emerging"],
    ["case_report", "uncertain"], ["other", "uncertain"],
  ] as const)("ceiling of %s is %s", (design, level) => {
    expect(designCeiling(design)).toBe(level);
  });

  it("treats unknown or missing designs as uncertain", () => {
    expect(designCeiling("made_up")).toBe("uncertain");
    expect(designCeiling(undefined)).toBe("uncertain");
    expect(designCeiling("constructor")).toBe("uncertain");
  });

  it("caps by the strongest cited source and never raises", () => {
    expect(capLevel("established", [{ design: "case_report" }])).toBe("uncertain");
    expect(capLevel("established", [{ design: "narrative_review" }])).toBe("emerging");
    expect(capLevel("established", [{ design: "case_report" }, { design: "guideline" }])).toBe("established");
    expect(capLevel("uncertain", [{ design: "guideline" }])).toBe("uncertain");
    expect(capLevel("emerging", [])).toBe("uncertain");
    expect(capLevel("bogus", [{ design: "guideline" }])).toBe("uncertain");
    expect(sourcesCeiling([])).toBe("uncertain");
  });
});
