import { describe, expect, it } from "vitest";
import { mergeProfileIntoDraft, profileReportText } from "../../lib/accounts/prefill";

const profile = {
  preferredName: "Alpha", dateOfBirth: "1990-01-01", primaryDiagnosis: "Vascular Ehlers-Danlos syndrome",
  diagnosedOn: "2026-03", city: "Boston", state: "MA", insurer: "Synthetic Health", plan: "PPO",
  travelLimitMiles: 200, goals: ["second_opinion" as const], medications: "SECRET-MED", memberId: "M-123",
};

describe("profile pre-fill", () => {
  it("fills only empty fields and reports which", () => {
    const { draft, filled } = mergeProfileIntoDraft({ diseaseName: "Report says X", homeCity: "", goals: [] }, profile);
    expect(draft).toMatchObject({ diseaseName: "Report says X", homeCity: "Boston", homeState: "MA", planId: "PPO", travelLimitMiles: 200, goals: ["second_opinion"] });
    expect(filled).not.toContain("diseaseName");
    expect(filled).toContain("homeCity");
  });
  it("is a no-op without a profile", () => {
    const d = { diseaseName: "", goals: [] };
    expect(mergeProfileIntoDraft(d, null)).toEqual({ draft: d, filled: [] });
  });
  it("writes a minimum-necessary report (no medications or identifiers)", () => {
    const text = profileReportText(profile)!;
    expect(text).toContain("Vascular Ehlers-Danlos syndrome");
    expect(text).not.toContain("SECRET-MED");
    expect(text).not.toContain("M-123");
    expect(profileReportText({ preferredName: "A", dateOfBirth: "1990-01-01" })).toBeNull();
  });
});
