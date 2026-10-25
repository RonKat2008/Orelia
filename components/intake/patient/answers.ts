import type { Case, CaseInput } from "@/lib/contracts";
import { goalSchema } from "@/lib/contracts";
import type { Goal } from "../goals";
import { INTAKE_COPY } from "./copy";
import { NEEDS_REVIEW } from "../fallback";

export type TravelChoice = "local" | "regional" | "far" | "anywhere";

export type PatientAnswers = {
  condition: string;
  city: string;
  state: string;
  travel: TravelChoice | null;
  /** Exact uploaded/profile limit, retained until a travel choice is changed. */
  travelLimitMiles?: number;
  goals: Goal[];
  insurer: string;
};

export type PatientQuestionId = "condition" | "home" | "travel" | "goals" | "insurance";

export const PATIENT_QUESTIONS: readonly PatientQuestionId[] = ["condition", "home", "travel", "goals", "insurance"];

export type ProfilePrefill = {
  condition?: string;
  city?: string;
  state?: string;
  insurer?: string;
  travelLimitMiles?: number;
};

export const MAX_CONDITION_LENGTH = 200;
const MIN_REPORT_LENGTH = 20;

/** Miles for each travel choice; undefined means no limit. */
export const TRAVEL_MILES: Record<TravelChoice, number | undefined> = {
  local: 25,
  regional: 100,
  far: 500,
  anywhere: undefined,
};

export const TRAVEL_LABELS: Record<TravelChoice, string> = INTAKE_COPY.travel.labels;

export const TRAVEL_HINTS: Record<TravelChoice, string> = INTAKE_COPY.travel.hints;

/** Short phrases used when a goal is read back in a sentence. */
export const GOAL_PHRASES: Record<Goal, string> = {
  second_opinion: "a second opinion",
  treatment: "treatment at a specialist center",
  trial: "a clinical trial",
  support: "support from people who understand",
  aid: "help with money or travel",
};

export function emptyAnswers(): PatientAnswers {
  return { condition: "", city: "", state: "", travel: null, goals: [], insurer: "" };
}

function orderedGoals(goals: readonly Goal[]): Goal[] {
  return goalSchema.options.filter((goal) => goals.includes(goal));
}

function homeText(answers: PatientAnswers): string {
  return [answers.city.trim(), answers.state.trim()].filter(Boolean).join(", ");
}

function travelText(travel: TravelChoice | null, exactMiles?: number): string {
  if (!travel && exactMiles === undefined) return "";
  const miles = exactMiles ?? (travel ? TRAVEL_MILES[travel] : undefined);
  return miles === undefined ? "anywhere in the country" : `up to ${miles} miles`;
}

export function answersToReport(answers: PatientAnswers): string {
  const goals = orderedGoals(answers.goals).map((goal) => GOAL_PHRASES[goal]);
  const parts: Array<[string, string]> = [
    ["Diagnosis", answers.condition.trim()],
    ["Home", homeText(answers)],
    ["Can travel", travelText(answers.travel, answers.travelLimitMiles)],
    ["Hoping for", goals.join(", ")],
    ["Insurance", answers.insurer.trim()],
  ];
  const text = parts
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}.`)
    .join("\n");
  // POST /api/cases needs at least 20 characters.
  return text.length >= MIN_REPORT_LENGTH ? text : `${text}\nWritten by the patient.`.trim();
}

export function answersToCaseInput(answers: PatientAnswers): Partial<CaseInput> {
  const miles = answers.travelLimitMiles ?? (answers.travel ? TRAVEL_MILES[answers.travel] : undefined);
  const city = answers.city.trim();
  const state = answers.state.trim();
  const insurer = answers.insurer.trim();
  const condition = answers.condition.trim();
  return {
    ...(condition ? { diseaseName: condition } : {}),
    ...(city ? { homeCity: city } : {}),
    ...(state ? { homeState: state } : {}),
    ...(miles !== undefined ? { travelLimitMiles: miles } : {}),
    goals: orderedGoals(answers.goals),
    ...(insurer ? { insurer } : {}),
  };
}

/** The patient's own answers win; extraction-only fields (subtype, stage, codes, plan) are kept. */
export function mergeExtracted(record: Case, answers: PatientAnswers): Case {
  const own = answersToCaseInput(answers);
  const merged: Case = {
    ...record,
    diseaseName: own.diseaseName ?? record.diseaseName,
    homeCity: own.homeCity,
    homeState: own.homeState,
    insurer: own.insurer,
    travelLimitMiles: own.travelLimitMiles,
    goals: own.goals ?? [],
  };
  if (merged.diseaseName.trim().toLowerCase() !== record.diseaseName.trim().toLowerCase()) {
    merged.diseaseCodes = undefined;
    merged.subtype = undefined;
    merged.stageSummary = undefined;
  }
  if (merged.insurer !== record.insurer) merged.planId = undefined;
  return merged;
}

export function canAdvance(id: PatientQuestionId, answers: PatientAnswers): boolean {
  switch (id) {
    case "condition": {
      const length = answers.condition.trim().length;
      return length > 0 && length <= MAX_CONDITION_LENGTH;
    }
    case "home":
      return Boolean(answers.city.trim() || answers.state.trim());
    case "travel":
      return answers.travel !== null;
    case "goals":
      return answers.goals.length > 0;
    case "insurance":
      return true;
  }
}

/** The error to show after Continue for an unanswered required question (problem plus fix), or undefined. */
export function questionError(id: PatientQuestionId, answers: PatientAnswers): string | undefined {
  if (canAdvance(id, answers)) return undefined;
  const q = INTAKE_COPY.questions;
  switch (id) {
    case "condition":
      return answers.condition.trim().length > MAX_CONDITION_LENGTH
        ? q.condition.errorTooLong(MAX_CONDITION_LENGTH)
        : q.condition.errorEmpty;
    case "home":
      return q.home.error;
    case "travel":
      return q.travel.error;
    case "goals":
      return q.goals.error;
    case "insurance":
      return undefined;
  }
}

function travelFromMiles(miles: number): TravelChoice {
  if (miles <= 25) return "local";
  if (miles <= 100) return "regional";
  if (miles <= 500) return "far";
  return "anywhere";
}

/** Fills only the answers the patient has not given yet. */
export function applyProfilePrefill(answers: PatientAnswers, profile: ProfilePrefill | null): PatientAnswers {
  if (!profile) return answers;
  return {
    ...answers,
    condition: answers.condition.trim() ? answers.condition : (profile.condition ?? ""),
    city: answers.city.trim() ? answers.city : (profile.city ?? ""),
    state: answers.state.trim() ? answers.state : (profile.state ?? ""),
    insurer: answers.insurer.trim() ? answers.insurer : (profile.insurer ?? ""),
    travel:
      answers.travel ?? (profile.travelLimitMiles !== undefined ? travelFromMiles(profile.travelLimitMiles) : null),
    travelLimitMiles: answers.travel === null ? profile.travelLimitMiles : answers.travelLimitMiles,
  };
}

/** Preserve exact extracted facts for the check screen; editing travel replaces the numeric limit. */
export function recordToAnswers(record: Case): PatientAnswers {
  return {
    condition: record.diseaseName === NEEDS_REVIEW ? "" : record.diseaseName,
    city: record.homeCity ?? "",
    state: record.homeState ?? "",
    travel: record.travelLimitMiles === undefined ? null : travelFromMiles(record.travelLimitMiles),
    travelLimitMiles: record.travelLimitMiles,
    goals: record.goals,
    insurer: record.insurer ?? "",
  };
}
