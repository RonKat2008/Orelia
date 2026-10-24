import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HOW_LEDE,
  HOW_STEPS,
  LANDING_PROMISES,
  NO_DIAGNOSIS_LINE,
} from "@/components/landing/content";
import { RARE_INTRO } from "@/components/pitch/RareFacts";
import { fleschKincaid } from "../../scripts/patient-readability";

const read = (p: string) => readFileSync(p, "utf8");

describe("landing rare-disease copy", () => {
  it("uses the rare-disease voice", () => {
    expect(HOW_LEDE).toMatch(/never seen a case|may never have seen a case/);
    expect(NO_DIAGNOSIS_LINE).toBe("No diagnosis yet? We can help you look for one too.");
    expect(HOW_STEPS.map((s) => s.body).join(" ")).toMatch(/few specialists/);
  });

  it("keeps new patient strings at grade 8 or below, in short sentences", () => {
    const strings = [HOW_LEDE, NO_DIAGNOSIS_LINE, RARE_INTRO, ...HOW_STEPS.map((s) => s.body), ...LANDING_PROMISES.map((p) => p.body)];
    for (const s of strings) {
      const score = fleschKincaid([s]);
      expect(score.grade, s).toBeLessThanOrEqual(8);
      expect(score.longest, s).toBeLessThanOrEqual(20);
    }
    expect(fleschKincaid(strings).grade).toBeLessThanOrEqual(8);
  });

  it("never guesses a diagnosis in the promises", () => {
    expect(LANDING_PROMISES.map((p) => p.body).join(" ")).toMatch(/never guess a diagnosis/);
  });
});

describe("zebra mark on the landing", () => {
  const landingFiles = [
    "app/page.tsx",
    "components/landing/Hero.tsx",
    "components/landing/HowItWorks.tsx",
    "components/landing/NeverSection.tsx",
    "components/landing/FinalCta.tsx",
  ];
  const source = landingFiles.map(read).join("\n");

  it("renders exactly one ZebraMark, in the hero, and no zebra texture", () => {
    expect(source.match(/<ZebraMark\b/g)).toHaveLength(1);
    expect(read("components/landing/Hero.tsx")).toMatch(/<ZebraMark\b/);
    expect(source).not.toMatch(/ZebraTexture/);
  });

  it("marks the symbol aria-hidden and fixed size", () => {
    const zebra = read("components/rare/Zebra.tsx");
    expect(zebra).toMatch(/aria-hidden="true"/);
    expect(zebra).toMatch(/size-3\.5/);
  });
});
