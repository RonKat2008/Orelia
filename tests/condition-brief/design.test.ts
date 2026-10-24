import { describe, expect, it } from "vitest";
import { ctgovPhaseDesign, pubmedDesign } from "@/lib/condition-brief/sources/design";
import { designCeiling } from "@/lib/condition-brief/tagging";
import { sourceDesignSchema } from "@/lib/condition-brief/contract";

describe("pubmedDesign", () => {
  const rows: [string[], string][] = [
    [["Practice Guideline", "Journal Article"], "guideline"],
    [["Guideline"], "guideline"],
    [["Consensus Development Conference"], "consensus"],
    [["Consensus Development Conference, NIH"], "consensus"],
    [["Systematic Review", "Review", "Journal Article"], "systematic_review"],
    [["Meta-Analysis", "Journal Article"], "meta_analysis"],
    [["Review", "Journal Article"], "narrative_review"],
    [["Case Reports", "Journal Article"], "case_report"],
    [["Preprint"], "preprint"],
    [["Clinical Trial"], "primary_study"],
    [["Clinical Trial, Phase II"], "primary_study"],
    [["Randomized Controlled Trial"], "primary_study"],
    [["Observational Study"], "primary_study"],
    [["Comparative Study"], "primary_study"],
    [["Multicenter Study"], "primary_study"],
    [["Journal Article"], "primary_study"],
    [["Editorial"], "other"],
    [[], "other"],
    [["review"], "narrative_review"],
  ];
  it.each(rows)("%j -> %s", (types, expected) => {
    expect(pubmedDesign(types)).toBe(expected);
  });

  it("maps NCBI Bookshelf GeneReviews to genereviews", () => {
    expect(pubmedDesign(["Review"], { bookshelfId: "NBK1116" })).toBe("genereviews");
    expect(pubmedDesign(["Review"], { bookshelfId: "XYZ" })).toBe("narrative_review");
  });

  it("highest-ranked label wins", () => {
    expect(pubmedDesign(["Case Reports", "Review"])).toBe("narrative_review");
    expect(pubmedDesign(["Review", "Guideline"])).toBe("guideline");
  });
});

describe("ctgovPhaseDesign", () => {
  const rows: [string[], string][] = [
    [["EARLY_PHASE1"], "trial_early"],
    [["PHASE1"], "trial_early"],
    [["PHASE1", "PHASE2"], "trial_early"],
    [["PHASE1/PHASE2"], "trial_early"],
    [["NA"], "trial_early"],
    [["PHASE2"], "trial_late"],
    [["PHASE2", "PHASE3"], "trial_late"],
    [["PHASE2/PHASE3"], "trial_late"],
    [["PHASE3"], "trial_late"],
    [["PHASE4"], "trial_late"],
    [[], "other"],
    [["BOGUS"], "other"],
  ];
  it.each(rows)("%j -> %s", (phases, expected) => {
    expect(ctgovPhaseDesign(phases)).toBe(expected);
  });
});

describe("designCeiling", () => {
  const established = ["guideline", "consensus", "systematic_review", "meta_analysis", "genereviews", "reference_page"];
  const emerging = ["narrative_review", "primary_study", "preprint", "trial_early", "trial_late", "grant", "registry"];
  const uncertain = ["case_report", "other"];
  it("covers every SourceDesign exactly once", () => {
    expect([...established, ...emerging, ...uncertain].sort()).toEqual([...sourceDesignSchema.options].sort());
  });
  it.each(established)("%s -> established", (d) => expect(designCeiling(d as never)).toBe("established"));
  it.each(emerging)("%s -> emerging", (d) => expect(designCeiling(d as never)).toBe("emerging"));
  it.each(uncertain)("%s -> uncertain", (d) => expect(designCeiling(d as never)).toBe("uncertain"));
  it("missing -> uncertain", () => expect(designCeiling(undefined)).toBe("uncertain"));
});
