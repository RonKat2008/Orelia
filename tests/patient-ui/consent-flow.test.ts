import { describe, expect, it } from "vitest";
import type { CaseInput } from "@/lib/contracts";
import { CONSENT_COPY } from "@/components/patient/flows/consent/copy";
import {
  audienceLabel,
  consentItems,
  firstScreen,
  flowOrder,
  nextScreen,
  previousScreen,
  sharedFromAnswers,
  summaryRows,
} from "@/components/patient/flows/consent/logic";

const record = {
  diseaseName: "vascular Ehlers-Danlos syndrome",
  homeCity: "Austin",
  homeState: "TX",
  travelLimitMiles: 100,
  goals: ["second_opinion"],
} as unknown as CaseInput;

describe("consentItems", () => {
  it("asks only about details that have a value, in field order", () => {
    const items = consentItems(record);
    expect(items.known.map((i) => i.key)).toEqual(["diseaseName", "homeCity", "homeState", "travelLimitMiles", "goals"]);
    expect(items.known.find((i) => i.key === "travelLimitMiles")?.value).toBe("Up to 100 miles");
    expect(items.missing).toEqual(["subtype", "stageSummary", "insurer", "planId"]);
  });

  it("never produces the words Not on file", () => {
    const items = consentItems({ ...record, insurer: "" } as CaseInput);
    expect(JSON.stringify(items)).not.toContain("Not on file");
  });
});

describe("navigation", () => {
  const items = consentItems(record);
  const order = flowOrder(items, false);

  it("starts on the first known detail and ends on the check page", () => {
    expect(firstScreen(order)).toBe("diseaseName");
    expect(nextScreen(order, "homeCity", false)).toBe("homeState");
    expect(nextScreen(order, "goals", false)).toBe("check");
    expect(firstScreen([])).toBe("check");
  });

  it("returns to the check page after a change", () => {
    expect(nextScreen(order, "homeCity", true)).toBe("check");
    expect(previousScreen(order, "homeCity", true, items.known.length)).toBe("check");
  });

  it("goes back one question, and leaves the flow from the first", () => {
    expect(previousScreen(order, "homeState", false, items.known.length)).toBe("homeCity");
    expect(previousScreen(order, "diseaseName", false, items.known.length)).toBeNull();
    expect(previousScreen(order, "check", false, items.known.length)).toBe("goals");
  });

  it("adds the missing details after the known ones, and their first Back returns to the check page", () => {
    const more = flowOrder(items, true);
    expect(more.slice(items.known.length)).toEqual(items.missing);
    expect(previousScreen(more, "subtype", false, items.known.length)).toBe("check");
    expect(nextScreen(more, "planId", false)).toBe("check");
  });
});

describe("sharedFromAnswers", () => {
  it("shares only what was answered yes, in field order", () => {
    expect(sharedFromAnswers({ homeCity: "yes", diseaseName: "yes", homeState: "no" })).toEqual(["diseaseName", "homeCity"]);
    expect(sharedFromAnswers({})).toEqual([]);
  });
});

describe("audienceLabel", () => {
  it("names one person, counts several", () => {
    expect(audienceLabel(["The EDS Society"])).toBe("The EDS Society");
    expect(audienceLabel(["A", "B"])).toBe("the 2 people you picked");
    expect(CONSENT_COPY.question(audienceLabel(["A", "B"]), "homeCity")).toBe("Can we tell the 2 people you picked your city?");
  });
});

describe("summaryRows", () => {
  it("shows the value for yes and Not shared for no", () => {
    const items = consentItems(record);
    const rows = summaryRows(["diseaseName", "homeCity", "insurer"], items, { diseaseName: "yes", homeCity: "no", insurer: "yes" });
    expect(rows.map((r) => r.value)).toEqual(["vascular Ehlers-Danlos syndrome", CONSENT_COPY.notShared, CONSENT_COPY.sharedLater]);
  });
});
