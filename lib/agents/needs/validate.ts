/**
 * Deterministic gate on the needs analyst's output. The model proposes; this code decides what survives:
 * - every item must cite >= 1 evidence id that is a fetched source (unsourced items are dropped by code);
 * - every shown string passes the no-medical-advice filter (a flagged item is dropped, not the run);
 * - questions are questions (end with "?", start with a question word), never recommendations;
 * - ids are re-assigned by code so downstream references (judge needsMet/needsMissed) are stable;
 * - undiagnosed mode: any item that reads as a diagnosis guess or names a condition is dropped (flagDiagnosisGuess),
 *   and emergency facts are dropped (they describe a known condition, and there is none).
 */
import type { BriefSource } from "@/lib/condition-brief/contract";
import type { GeneratedNeeds, NeedSource, NeedsSearchTerms } from "@/lib/contracts";
import { flagDiagnosisGuess } from "@/lib/rare-disease/no-diagnosis";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";

export interface ValidateNeedsOptions {
  /** The case has no diagnosis yet: drop anything that guesses at or names one. */
  undiagnosed?: boolean;
}

export interface Dropped {
  id: string;
  reason: string;
}

export interface ValidatedNeeds extends GeneratedNeeds {
  sources: NeedSource[];
  searchTerms: NeedsSearchTerms;
  dropped: Dropped[];
}

const QUESTION_START = /^(is|are|what|which|who|how|could|can|would|will|do|does|did|when|where|has|have)\b/i;
/** Recommendation-shaped questions ("Should I take/stop/start ...") are advice in disguise. */
const ADVICE_QUESTION = /\bshould\s+i\s+(take|start|stop|switch|have|get|undergo|try|avoid)\b/i;
/** Service phrasing only: a need is about what a service offers, never what the patient should do medically. */
const PATIENT_DIRECTIVE = /\b(you should|you must|you need to|we recommend|i recommend|patients should (take|start|stop|avoid))\b/i;
/** Emergency facts are written for staff: no second person, no imperative opener. */
const PATIENT_ADDRESSED = /\b(you|your|yours)\b|^\s*(call|go|tell|ask|avoid|take|stop|seek|bring|carry|wear|do not|don't|never)\b/i;
const SEARCH_TERM = /^[a-z0-9][a-z0-9 '&/-]{1,58}[a-z0-9]$/i;
const MAX_TERMS_PER_TARGET = 4;

const PREFIX = {
  specialties: "spec",
  centerCapabilities: "cap",
  redFlags: "flag",
  trialEligibility: "elig",
  supportNeeds: "support",
  questions: "q",
  emergencyFacts: "emer",
  workup: "workup",
} as const;
type Section = keyof typeof PREFIX;

function adviceIn(...texts: (string | undefined)[]): string | undefined {
  for (const t of texts) {
    if (!t) continue;
    if (flagMedicalAdvice(t).flagged) return "flagged as medical advice";
    if (PATIENT_DIRECTIVE.test(t)) return "phrased as an instruction to the patient, not what to look for in a service";
  }
  return undefined;
}

export function cleanSearchTerm(raw: string): string | undefined {
  const t = raw.replace(/\s+/g, " ").trim();
  const words = t.split(" ").length;
  return SEARCH_TERM.test(t) && words >= 1 && words <= 6 && !flagMedicalAdvice(t).flagged ? t.toLowerCase() : undefined;
}

function texts(section: Section, item: Record<string, unknown>): (string | undefined)[] {
  const s = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : undefined);
  if (section === "specialties") return [s("specialty"), s("subspecialty"), s("why"), s("plain")];
  if (section === "questions" || section === "emergencyFacts") return [s("text")];
  return [s("text"), s("plain")];
}

/** Every string of an item that could reach a person or a search (undiagnosed guard looks at all of them). */
function allTexts(section: Section, item: Record<string, unknown>): string[] {
  const list = (k: string) => (Array.isArray(item[k]) ? (item[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  return [...texts(section, item), ...list("searchTerms"), ...list("organizations")].filter((t): t is string => !!t);
}

function diagnosisGuessIn(section: Section, item: Record<string, unknown>): string | undefined {
  const hit = allTexts(section, item).map((t) => flagDiagnosisGuess(t)).find((f) => f.flagged);
  return hit ? "reads as a diagnosis guess or names a condition (undiagnosed case)" : undefined;
}

/** Keep sourced, safe items; map sources to {id,url,title}; derive search terms only from kept items. */
export function validateNeeds(raw: GeneratedNeeds, collected: readonly BriefSource[], opts: ValidateNeedsOptions = {}): ValidatedNeeds {
  const byId = new Map(collected.map((s) => [s.id, s]));
  const dropped: Dropped[] = [];
  const used = new Set<string>();

  function keep<T extends { id: string; evidenceIds: string[] }>(section: Section, items: readonly T[], extra?: (item: T) => string | undefined): T[] {
    const out: T[] = [];
    for (const item of items) {
      const label = `${section}:${item.id}`;
      const evidenceIds = [...new Set(item.evidenceIds.filter((id) => byId.has(id)))];
      if (evidenceIds.length === 0) {
        dropped.push({ id: label, reason: item.evidenceIds.length ? "cites no fetched source" : "unsourced" });
        continue;
      }
      const fields = item as unknown as Record<string, unknown>;
      const why = adviceIn(...texts(section, fields)) ?? (opts.undiagnosed ? diagnosisGuessIn(section, fields) : undefined) ?? extra?.(item);
      if (why) {
        dropped.push({ id: label, reason: why });
        continue;
      }
      evidenceIds.forEach((id) => used.add(id));
      out.push({ ...item, id: `${PREFIX[section]}-${out.length + 1}`, evidenceIds });
    }
    return out;
  }

  const specialties = keep("specialties", raw.specialties);
  const centerCapabilities = keep("centerCapabilities", raw.centerCapabilities);
  const redFlags = keep("redFlags", raw.redFlags);
  const trialEligibility = keep("trialEligibility", raw.trialEligibility);
  const supportNeeds = keep("supportNeeds", raw.supportNeeds);
  const questions = keep("questions", raw.questions, (q) => {
    const t = q.text.trim();
    if (!t.endsWith("?") || !QUESTION_START.test(t)) return "not a question";
    if (ADVICE_QUESTION.test(t)) return "recommendation-shaped question";
    return undefined;
  });

  const rawEmergency = raw.emergencyFacts ?? [];
  if (opts.undiagnosed) rawEmergency.forEach((f) => dropped.push({ id: `emergencyFacts:${f.id}`, reason: "emergency facts need a known condition (undiagnosed case)" }));
  // Facts for emergency staff, never instructions to the patient.
  const emergencyFacts = opts.undiagnosed ? [] : keep("emergencyFacts", rawEmergency, (f) => (PATIENT_ADDRESSED.test(f.text) ? "addressed to the patient; emergency facts are for staff" : undefined));
  const workup = keep("workup", raw.workup ?? []);

  const kept = { specialties, centerCapabilities, redFlags, trialEligibility, supportNeeds, questions, emergencyFacts, workup };
  const sources: NeedSource[] = collected
    .filter((s) => used.has(s.id))
    .map((s) => ({ id: s.id, url: s.url, title: s.title, kind: s.kind, fetchedAt: s.fetchedAt }));
  return { ...kept, sources, searchTerms: deriveSearchTerms(kept), dropped };
}

function uniqueTerms(terms: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of terms) {
    const t = raw ? cleanSearchTerm(raw) : undefined;
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TERMS_PER_TARGET) break;
  }
  return out;
}

/**
 * Search terms per research target, derived in code from KEPT (sourced) items only, so an unsourced need can
 * never steer a search. Trials take no extra query terms: ClinicalTrials.gov is queried by condition, and the
 * eligibility features are used as a screen by the judge instead.
 */
export function deriveSearchTerms(n: Pick<GeneratedNeeds, "specialties" | "centerCapabilities" | "supportNeeds">): NeedsSearchTerms {
  const aidKinds = new Set(["travel_lodging", "genetic_counseling_cost", "financial"]);
  return {
    centers: uniqueTerms([...n.centerCapabilities.flatMap((c) => c.searchTerms), ...n.specialties.flatMap((s) => s.searchTerms)]),
    experts: uniqueTerms(n.specialties.flatMap((s) => [s.subspecialty ?? s.specialty, ...s.searchTerms])),
    trials: [],
    advocacy: uniqueTerms(n.supportNeeds.filter((s) => s.kind === "advocacy").flatMap((s) => [...s.organizations, ...s.searchTerms])),
    aid: uniqueTerms(n.supportNeeds.filter((s) => aidKinds.has(s.kind)).flatMap((s) => s.searchTerms)),
  };
}
