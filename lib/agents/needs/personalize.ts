/**
 * Cheap per-case personalization of cached disease-level needs. Pure code (no model): it adds notes from the
 * confirmed case (home state, travel limit, goals, insurer) and the KINDS of documents the patient has added.
 * Document contents are never read here, and nothing personal goes back into the shared cache.
 */
import type { CareNeeds, CareNeedsBase, CaseInput } from "@/lib/contracts";

export interface DocumentHint {
  kind: string;
  /** Titles of the patient's own uploaded documents (lane K). Contents are never read here. */
  title?: string;
}

const PATIENT_DOC_KINDS = new Set(["intake_report", "medical_record", "patient_note"]);

export function personalizeNeeds(
  base: CareNeedsBase,
  caseId: string,
  c: CaseInput,
  meta: { fromCache: boolean; elapsedMs: number; documents?: readonly DocumentHint[] },
): CareNeeds {
  const notes: CareNeeds["personal"]["notes"] = [];
  const add = (id: string, text: string) => notes.push({ id, text });

  if (c.homeState) {
    const limit = c.travelLimitMiles !== undefined ? `${c.travelLimitMiles} miles` : "your travel limit (500 miles if not set)";
    add("travel", `Resources are checked against ${limit} from ${c.homeState}; anything beyond it is marked, not hidden.`);
    add("license", `Clinicians outside ${c.homeState} may need a license in ${c.homeState} for telehealth visits; ask each one.`);
  }
  if (c.goals.includes("trial") && base.trialEligibility.length) {
    add("trial", `Trial listings are screened for: ${base.trialEligibility.map((e) => e.feature.replace(/_/g, " ")).join(", ")}. Only the study team can decide eligibility.`);
  }
  if (c.goals.includes("second_opinion") && base.specialties.length) {
    add("second-opinion", `For a second opinion, look for: ${base.specialties.slice(0, 3).map((s) => s.subspecialty ?? s.specialty).join(", ")}.`);
  }
  if ((c.goals.includes("aid") || c.goals.includes("support")) && base.supportNeeds.length) {
    add("support", `Support and aid to look for: ${[...new Set(base.supportNeeds.map((s) => s.kind.replace(/_/g, " ")))].join(", ")}.`);
  }
  if (c.insurer) add("insurer", `Ask each center and clinician whether they are in network with ${c.insurer.slice(0, 80)}.`);
  const docs = (meta.documents ?? []).filter((d) => PATIENT_DOC_KINDS.has(d.kind)).length;
  const titles = (meta.documents ?? []).flatMap((d) => (d.title ? [d.title.replace(/\s+/g, " ").slice(0, 60)] : [])).slice(0, 3);
  if (titles.length > 0) add("documents", `Your documents (${titles.join("; ")}) can answer intake and trial-screening questions, such as how the diagnosis was confirmed. Only what you tick is ever shared.`);
  else if (docs > 0) add("documents", `You have ${docs} document${docs === 1 ? "" : "s"} in Wayfinder; they may answer intake and trial-screening questions (for example, how the diagnosis was confirmed).`);

  return {
    ...base,
    caseId,
    fromCache: meta.fromCache,
    elapsedMs: Math.max(0, Math.round(meta.elapsedMs)),
    personal: {
      ...(c.homeState ? { homeState: c.homeState } : {}),
      ...(c.travelLimitMiles !== undefined ? { travelLimitMiles: c.travelLimitMiles } : {}),
      goals: [...c.goals],
      notes: notes.slice(0, 8),
    },
  };
}
