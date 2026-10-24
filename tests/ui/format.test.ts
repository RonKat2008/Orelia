import { describe, expect, it } from "vitest";
import { cn } from "@/lib/ui/cn";
import { formatSourceDate, getInitials, hashToBucket, parseSource, toPercent } from "@/lib/ui/format";

describe("cn", () => {
  it("lets later utilities win and keeps custom type sizes separate from colours", () => {
    expect(cn("px-2 text-ink", "px-4")).toBe("text-ink px-4");
    expect(cn("text-h1 text-ink")).toBe("text-h1 text-ink");
    expect(cn("text-h1", "text-h3")).toBe("text-h3");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("parseSource", () => {
  it("strips www and keeps https links navigable", () => {
    expect(parseSource("https://www.rarediseases.org/x?y=1")).toEqual({
      href: "https://www.rarediseases.org/x?y=1",
      domain: "rarediseases.org",
    });
  });

  it("refuses non-web protocols", () => {
    expect(parseSource("javascript:alert(1)").href).toBeNull();
  });

  it("falls back to the raw input when unparseable", () => {
    expect(parseSource("not a url")).toEqual({ href: null, domain: "not a url" });
  });
});

describe("formatSourceDate", () => {
  it("formats ISO dates in UTC", () => {
    expect(formatSourceDate("2026-03-04")).toBe("Mar 4, 2026");
  });

  it("returns null for missing or invalid dates", () => {
    expect(formatSourceDate(undefined)).toBeNull();
    expect(formatSourceDate("nope")).toBeNull();
  });
});

describe("getInitials", () => {
  it("uses first and last word", () => {
    expect(getInitials("Maria del Carmen Ortiz")).toBe("MO");
    expect(getInitials("prince")).toBe("P");
    expect(getInitials("   ")).toBe("?");
  });
  it("never leads with punctuation (parenthetical notes are ignored)", () => {
    expect(getInitials("Quinn (test)")).toBe("Q");
    expect(getInitials("Quinn Adams (test)")).toBe("QA");
    expect(getInitials("(test) Quinn")).toBe("Q");
    expect(getInitials("(test)")).toBe("T");
  });
});

describe("hashToBucket", () => {
  it("is deterministic and in range", () => {
    const a = hashToBucket("Dr. Lee", 4);
    expect(a).toBe(hashToBucket("Dr. Lee", 4));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(4);
    expect(hashToBucket("x", 0)).toBe(0);
  });
});

describe("toPercent", () => {
  it("clamps and handles bad input", () => {
    expect(toPercent(50)).toBe(50);
    expect(toPercent(3, 4)).toBe(75);
    expect(toPercent(150)).toBe(100);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(Number.NaN)).toBe(0);
    expect(toPercent(1, 0)).toBe(0);
  });
});
