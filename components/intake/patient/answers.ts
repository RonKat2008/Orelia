import type { Case, CaseInput } from "@/lib/contracts";
import { goalSchema } from "@/lib/contracts";
import type { Goal } from "../goals";

export type TravelChoice = "local" | "regional" | "far" | "anywhere";

export type PatientAnswers = {
  condition: string;
  city: string;
  state: string;
  travel: TravelChoice | null;
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

export const TRAVEL_LABELS: Record<TravelChoice, string> = {
  local: "Close to home",
  regional: "A few hours away",
  far: "Anywhere in the region",
  anywhere: "Anywhere it takes",
};

export const TRAVEL_HINTS: Record<TravelChoice, string> = {
  local: "Up to about 25 miles.",
  regional: "Up to about 100 miles.",
  far: "Up to about 500 miles.",
  anywhere: "No limit on distance.",
};

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

function travelText(travel: TravelChoice | null): string {
  if (!travel) return "";
  const miles = TRAVEL_MILES[travel];
  return miles === undefined ? "anywhere in the country" : `up to ${miles} miles`;
}

export function answersToReport(answers: PatientAnswers): string {
  const goals = orderedGoals(answers.goals).map((goal) => GOAL_PHRASES[goal]);
  const parts: Array<[string, string]> = [
    ["Diagnosis", answers.condition.trim()],
    ["Home", homeText(answers)],
    ["Can travel", travelText(answers.travel)],
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
  const miles = answers.travel ? TRAVEL_MILES[answers.travel] : undefined;
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
  const merged: Case = { ...record };
  if (own.diseaseName) merged.diseaseName = own.diseaseName;
  if (own.homeCity) merged.homeCity = own.homeCity;
  if (own.homeState) merged.homeState = own.homeState;
  if (own.insurer) merged.insurer = own.insurer;
  if (answers.travel) merged.travelLimitMiles = own.travelLimitMiles;
  if (own.goals && own.goals.length > 0) merged.goals = own.goals;
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
  };
}
