import type { PatientStep, PatientTimelineItem, PatientTone } from "@/lib/patient-status/types";
import { PATIENT_STEPS } from "@/lib/patient-status/types";
import { PATIENT_HOME_COPY } from "./copy";

/** How many history items the case home shows before "See all". */
export const HAPPENED_LIMIT = 3;

/** Badge tone for the status line. Patient view uses only teal, ok and warn here (docs/DESIGN-v2.md 4.5). */
export function statusBadgeTone(tone: PatientTone): "teal" | "ok" | "warn" {
  if (tone === "good") return "ok";
  if (tone === "problem") return "warn";
  return "teal";
}

export function statusWord(tone: PatientTone): string {
  return PATIENT_HOME_COPY.status[tone];
}

/** The newest items first, capped, plus whether there is more to see. Never mutates the input. */
export function latestHappened(
  items: readonly PatientTimelineItem[],
  limit: number = HAPPENED_LIMIT,
): { shown: PatientTimelineItem[]; more: boolean } {
  return { shown: items.slice(0, limit), more: items.length > limit };
}

/** "Step 3 of 4 · You choose". */
export function stepText(current: PatientStep): string {
  const index = PATIENT_STEPS.findIndex((step) => step.id === current);
  const safe = index < 0 ? 0 : index;
  return PATIENT_HOME_COPY.steps.text(safe + 1, PATIENT_STEPS.length, PATIENT_STEPS[safe]!.label);
}
