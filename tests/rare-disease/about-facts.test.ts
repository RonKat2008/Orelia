import { describe, expect, it } from "vitest";
import raw from "../../data/rare-disease-facts.json";
import { RareFactsFileSchema, claimNumbersAreSourced, loadRareFacts, numbersIn } from "@/lib/rare-disease/facts";

const SOURCE_HOSTS = ["rarediseases.org", "rarediseases.info.nih.gov", "ncats.nih.gov", "eurordis.org"];

describe("rare-disease facts", () => {
  const file = RareFactsFileSchema.parse(raw);

  it("has the count and time-to-diagnosis facts", () => {
    expect(file.facts.map((f) => f.id)).toEqual(expect.arrayContaining(["condition-count", "time-to-diagnosis"]));
  });

  it("gives every fact an https source from NORD, NIH or EURORDIS", () => {
    for (const fact of file.facts) {
      const url = new URL(fact.url);
      expect(url.protocol).toBe("https:");
      expect(SOURCE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))).toBe(true);
      expect(Number.isNaN(Date.parse(fact.fetchedAt))).toBe(false);
    }
  });

  it("only renders numbers that literally appear in the stored excerpt", () => {
    for (const fact of file.facts) {
      const sourced = numbersIn(fact.excerpt);
      for (const n of numbersIn(fact.claim)) expect(sourced).toContain(n);
    }
    expect(loadRareFacts()).toHaveLength(file.facts.length);
  });

  it("drops a fact whose claim has a number the excerpt does not contain", () => {
    expect(claimNumbersAreSourced("About 7,000 diseases.", "More than 10,000 diseases exist.")).toBe(false);
    const bad = { facts: [{ ...file.facts[0], claim: "Over 7,000 diseases exist." }] };
    expect(loadRareFacts(bad)).toHaveLength(0);
  });

  it("rejects non-https sources", () => {
    const bad = { facts: [{ ...file.facts[0], url: "http://rarediseases.org/x" }] };
    expect(() => loadRareFacts(bad)).toThrow();
  });
});
