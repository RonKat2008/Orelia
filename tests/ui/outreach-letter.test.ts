import { describe, expect, it } from "vitest";
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE } from "@/lib/safety/disclosure";
import { buildLetterPreview, splitDisclosure } from "@/components/outreach/letter";

describe("splitDisclosure", () => {
  it("lifts the email disclosure out of the body", () => {
    const parts = splitDisclosure(`Hello\n\nA question.\n\n${AI_DISCLOSURE_EMAIL}`);
    expect(parts.map((part) => part.kind)).toEqual(["text", "disclosure"]);
    expect(parts[1].text).toBe(AI_DISCLOSURE_EMAIL);
  });

  it("finds the spoken disclosure at the start of a call script", () => {
    const parts = splitDisclosure(`${AI_DISCLOSURE_VOICE} I am calling about intake.`);
    expect(parts[0]).toEqual({ kind: "disclosure", text: AI_DISCLOSURE_VOICE });
    expect(parts[1].kind).toBe("text");
  });

  it("returns plain text when there is no disclosure", () => {
    expect(splitDisclosure("Just words")).toEqual([{ kind: "text", text: "Just words" }]);
  });
});

describe("buildLetterPreview", () => {
  const shares = [
    { key: "diseaseName", label: "Diagnosis", value: "Epithelioid sarcoma" },
    { key: "homeState", label: "Home state", value: "AZ" },
  ] as const;

  it("mentions only ticked fields", () => {
    const text = buildLetterPreview("email", shares).lines.join(" ");
    expect(text).toContain("Epithelioid sarcoma");
    expect(text).toContain("AZ");
    expect(text).not.toContain("Bluepeak");
  });

  it("falls back to no case details when nothing is ticked", () => {
    const text = buildLetterPreview("voice", []).lines.join(" ");
    expect(text).toContain("an adult patient");
  });
});
