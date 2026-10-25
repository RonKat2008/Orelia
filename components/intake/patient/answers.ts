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
  /** null or undefined until asked. false sends the patient down the undiagnosed path. */
  diagnosed?: boolean | null;
  /** Undiagnosed path: the patient's own words about what they are dealing with. Quoted back, never interpreted. */
  symptoms?: string;
};

export type PatientQuestionId = "diagnosis" | "condition" | "symptoms" | "home" | "needs";

/** Diagnosed path. Insurance is an optional line on the check screen, and travel plus goals share one screen. */
export const PATIENT_QUESTIONS: readonly PatientQuestionId[] = ["diagnosis", "condition", "home", "needs"];
export const UNDIAGNOSED_QUESTIONS: readonly PatientQuestionId[] = ["diagnosis", "symptoms", "home", "needs"];

/** The screens for these answers: "Not yet" swaps the condition screen for the patient's own words. */
export function questionsFor(answers: Pick<PatientAnswers, "diagnosed">): readonly PatientQuestionId[] {
  return answers.diagnosed === false ? UNDIAGNOSED_QUESTIONS : PATIENT_QUESTIONS;
}

/** Common answers for the travel-and-goals screen. Shown ticked, never hidden, and the patient can change them. */
export const DEFAULT_TRAVEL: TravelChoice = "regional";
export const DEFAULT_GOALS: readonly Goal[] = ["second_opinion", "treatment"];

export function withNeedsDefaults(answers: PatientAnswers): PatientAnswers {
  return {
    ...answers,
    travel: answers.travel ?? (answers.travelLimitMiles === undefined ? DEFAULT_TRAVEL : null),
    goals: answers.goals.length > 0 ? answers.goals : [...DEFAULT_GOALS],
  };
}

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

/** Fields for POST /api/cases with undiagnosed:true. Built from the patient's answers only: no model reads them. */
export function undiagnosedFields(answers: PatientAnswers): Partial<CaseInput> {
  const { diseaseName: _name, ...rest } = answersToCaseInput(answers);
  void _name;
  const notes = (answers.symptoms ?? "").trim();
  return { ...rest, ...(notes ? { symptomNotes: notes } : {}) };
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
  if (record.undiagnosed === true) {
    // An undiagnosed case keeps the fixed label. Their own words are the only description, and nothing guesses a name.
    const notes = (answers.symptoms ?? "").trim();
    return { ...merged, diseaseName: record.diseaseName, undiagnosed: true, ...(notes ? { symptomNotes: notes } : {}) };
  }
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
    case "diagnosis":
      return answers.diagnosed === true || answers.diagnosed === false;
    case "symptoms":
      return true;
    case "condition": {
      const length = answers.condition.trim().length;
      return length > 0 && length <= MAX_CONDITION_LENGTH;
    }
    case "home":
      return Boolean(answers.city.trim() || answers.state.trim());
    case "needs":
      return (answers.travel !== null || answers.travelLimitMiles !== undefined) && answers.goals.length > 0;
  }
}

/** The error to show after Continue for an unanswered required question (problem plus fix), or undefined. */
export function questionError(id: PatientQuestionId, answers: PatientAnswers): string | undefined {
  if (canAdvance(id, answers)) return undefined;
  const q = INTAKE_COPY.questions;
  switch (id) {
    case "diagnosis":
      return q.diagnosis.error;
    case "symptoms":
      return undefined;
    case "condition":
      return answers.condition.trim().length > MAX_CONDITION_LENGTH
        ? q.condition.errorTooLong(MAX_CONDITION_LENGTH)
        : q.condition.errorEmpty;
    case "home":
      return q.home.error;
    case "needs":
      return answers.travel === null && answers.travelLimitMiles === undefined ? q.travel.error : q.goals.error;
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
