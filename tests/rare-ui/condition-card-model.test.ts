import { describe, expect, it } from "vitest";
import { isInAppHref, pickCompactFacts, factText } from "@/components/rare/condition-card-model";
import type { ConditionCard, ConditionFact } from "@/lib/rare-disease/condition-facts";

const src = { label: "Orphanet", href: "https://www.orpha.net/x" };
const fact = (kind: ConditionFact["kind"], plain?: string): ConditionFact => ({
  kind, id: kind, label: kind, value: `raw-${kind}`, source: src, ...(plain ? { plain } : {}),
});
const card = (facts: ConditionFact[]): ConditionCard => ({ caseId: "c", undiagnosed: false, facts });

describe("pickCompactFacts", () => {
  it("keeps the name and at most two plain extras in a fixed order", () => {
    const picked = pickCompactFacts(card([fact("centers", "c"), fact("name", "Name"), fact("experts", "e"), fact("prevalence", "p")]));
    expect(picked.name?.kind).toBe("name");
    expect(picked.extras.map((f) => f.kind)).toEqual(["prevalence", "experts"]);
  });

  it("skips codes and facts without a plain sentence", () => {
    const picked = pickCompactFacts(card([fact("name", "N"), fact("code"), fact("prevalence")]));
    expect(picked.extras).toEqual([]);
  });

  it("returns a null name when the card has none", () => {
    expect(pickCompactFacts(card([])).name).toBeNull();
  });
});

describe("helpers", () => {
  it("factText prefers the plain sentence", () => {
    expect(factText(fact("name", "Plain"))).toBe("Plain");
    expect(factText(fact("name"))).toBe("raw-name");
  });
  it("isInAppHref", () => {
    expect(isInAppHref("/cases/1/documents")).toBe(true);
    expect(isInAppHref("https://x.org")).toBe(false);
  });
});
