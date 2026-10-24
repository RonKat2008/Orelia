import { describe, expect, it } from "vitest";
import { flagDiagnosisGuess } from "@/lib/rare-disease/no-diagnosis";

describe("flagDiagnosisGuess", () => {
  it.each([
    "You may have Marfan syndrome.",
    "These symptoms are consistent with an autoimmune problem.",
    "This could be a mitochondrial disease.",
    "Ask the clinic to rule out lupus.",
    "Pain and rashes are suggestive of vasculitis.",
    "It sounds like fibromyalgia.",
  ])("flags a diagnostic suggestion: %s", (text) => {
    expect(flagDiagnosisGuess(text).flagged).toBe(true);
  });

  it.each([
    "A medical genetics clinic that sees adults without a diagnosis.",
    "The Undiagnosed Diseases Network reviews applications from people with undiagnosed diseases.",
    "Programs that help pay for exome or genome sequencing.",
    "I get tired after walking and my joints hurt.",
    "Support from Syndromes Without A Name for people with rare or genetic conditions.",
    "A team that can explain a genetic test result.",
  ])("passes service and symptom text: %s", (text) => {
    expect(flagDiagnosisGuess(text)).toEqual({ flagged: false, matches: [] });
  });
});
