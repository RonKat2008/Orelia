import { describe, expect, it } from "vitest";
import { previewShortlist, selectionKey, type ShortlistCard } from "@/components/shortlist/data";
import { SHORTLIST_COPY } from "@/components/patient/flows/shortlist/copy";
import {
  isGoodMatch,
  metaLine,
  orderCards,
  sourceCount,
  splitSuggested,
  suggestedCount,
  togglePick,
  whyThisOne,
} from "@/components/patient/flows/shortlist/logic";

const cards: ShortlistCard[] = previewShortlist;

describe("splitSuggested", () => {
  it("shows the suggested ones first and hides the rest", () => {
    const key = selectionKey(cards[1]!);
    const { first, more } = splitSuggested(cards, [key]);
    expect(first.map(selectionKey)).toEqual([key]);
    expect(more).toHaveLength(cards.length - 1);
  });

  it("falls back to the first 3 when nothing is suggested", () => {
    const { first, more } = splitSuggested(cards, []);
    expect(first).toHaveLength(Math.min(3, cards.length));
    expect(first.length + more.length).toBe(cards.length);
  });
});

describe("orderCards", () => {
  it("puts suggested cards first and drops excluded ones", () => {
    const excluded = { ...cards[0]!, tier: "exclude" as const };
    const best = { ...cards[1]!, tier: "best" as const };
    const ordered = orderCards([excluded, best], []);
    expect(ordered.map(selectionKey)).toEqual([selectionKey(best)]);
  });
});

describe("row text", () => {
  it("builds one meta line with type and place", () => {
    const center = cards.find((c) => c.resource.kind === "institution")!;
    expect(metaLine(center)).toContain("Care center");
    expect(metaLine(center)).toContain("Houston, TX");
  });

  it("gives at most 2 sentences for Why this one", () => {
    const card = { ...cards[0]!, tierReasons: [{ text: "One. Two. Three.", evidenceIds: [] }] };
    expect(whyThisOne(card, "Plain first.")).toBe("Plain first. One.");
  });

  it("counts distinct sources and marks good matches", () => {
    expect(sourceCount(cards[0]!)).toBeGreaterThan(0);
    expect(isGoodMatch({ ...cards[0]!, tier: "best" }, [])).toBe(true);
    expect(isGoodMatch({ ...cards[0]!, tier: "good" }, [])).toBe(false);
  });
});

describe("togglePick", () => {
  it("adds, removes and stops at the limit without mutating", () => {
    const start = ["a"];
    expect(togglePick(start, "b")).toEqual(["a", "b"]);
    expect(togglePick(start, "a")).toEqual([]);
    expect(togglePick(["a", "b", "c", "d", "e"], "f")).toEqual(["a", "b", "c", "d", "e"]);
    expect(start).toEqual(["a"]);
  });
});

describe("copy", () => {
  it("writes the lede and button as the spec says", () => {
    expect(SHORTLIST_COPY.lede(16, 5, 3)).toBe("We found 16. You can pick up to 5. We suggest these 3.");
    expect(SHORTLIST_COPY.continue(2)).toBe("Continue with 2 chosen");
    expect(SHORTLIST_COPY.showMore(13)).toBe("Show 13 more");
    expect(suggestedCount(cards, [selectionKey(cards[0]!)])).toBe(1);
  });
});
