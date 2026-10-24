import { describe, expect, it } from "vitest";
import { planLine, resourceKindLabel, shareLabel } from "@/lib/patient-status/plain";

const step = (order: number, channel: "email" | "voice" | "web_form", purpose: "intro" | "apply" | "follow_up" | "confirm" | "verify", enabled = true) => ({ order, channel, purpose, enabled });

describe("planLine", () => {
  it("describes one email", () => {
    expect(planLine([step(1, "email", "intro")])).toBe("We'll email them.");
  });

  it("describes a form then a follow-up call, in order", () => {
    expect(planLine([step(2, "voice", "follow_up"), step(1, "web_form", "apply")])).toBe(
      "We'll fill in their online form, then call if there's no reply.",
    );
  });

  it("skips steps the patient turned off", () => {
    expect(planLine([step(1, "email", "intro"), step(2, "voice", "follow_up", false)])).toBe("We'll email them.");
  });

  it("is honest when there is no way to reach them", () => {
    expect(planLine([])).toBe("We couldn't find a public way to reach them, so we won't contact them.");
  });
});

describe("labels", () => {
  it("names resource kinds plainly", () => {
    expect(resourceKindLabel("expert")).toBe("Specialist");
    expect(resourceKindLabel("institution")).toBe("Care center");
    expect(resourceKindLabel("trial")).toBe("Research study");
    expect(resourceKindLabel("organization", "advocacy")).toBe("Support group");
    expect(resourceKindLabel("organization", "financial_aid")).toBe("Help with costs");
    expect(resourceKindLabel("organization", "travel_aid")).toBe("Help with travel");
  });

  it("words shareable fields for a patient", () => {
    expect(shareLabel("diseaseName")).toBe("Your diagnosis");
    expect(shareLabel("planId")).toBe("Your insurance member ID");
    expect(shareLabel("unknown")).toBe("unknown");
  });
});
