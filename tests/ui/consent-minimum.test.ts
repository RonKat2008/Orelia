import { describe, expect, it } from "vitest";
import { minimumFields, NEEDED_FOR } from "@/components/patient/flows/consent/logic";
import type { ShareableFieldKey } from "@/components/outreach/fields";

const ALL: ShareableFieldKey[] = ["diseaseName", "subtype", "stageSummary", "homeCity", "homeState", "insurer", "planId", "travelLimitMiles", "goals"];

describe("minimumFields", () => {
  it("ticks only the diagnosis when nothing is known about the contacts", () => {
    expect(minimumFields([], ALL)).toEqual(["diseaseName"]);
  });

  it("ticks diagnosis and state for a trial, and nothing personal", () => {
    expect(minimumFields(["trial"], ALL)).toEqual(["diseaseName", "homeState"]);
  });

  it("adds insurance only for a care center", () => {
    expect(minimumFields(["institution"], ALL)).toEqual(["diseaseName", "homeState", "insurer"]);
    expect(minimumFields(["expert"], ALL)).not.toContain("insurer");
  });

  it("asks a support group for goals, never for the member ID or report summary", () => {
    const fields = minimumFields(["organization"], ALL);
    expect(fields).toEqual(["diseaseName", "goals"]);
    expect(fields).not.toContain("planId");
    expect(fields).not.toContain("stageSummary");
  });

  it("is the union across the picked contacts, in the usual field order", () => {
    expect(minimumFields(["organization", "institution"], ALL)).toEqual(["diseaseName", "homeState", "insurer", "goals"]);
  });

  it("never ticks a detail we do not have", () => {
    expect(minimumFields(["institution"], ["diseaseName", "goals"])).toEqual(["diseaseName"]);
  });

  it("falls back to the diagnosis for an unknown kind", () => {
    expect(minimumFields(["mystery"], ALL)).toEqual(["diseaseName"]);
  });

  it("explains every default in plain words", () => {
    for (const key of ["diseaseName", "homeState", "insurer", "goals"] as const) expect(NEEDED_FOR[key]).toBeTruthy();
  });
});
