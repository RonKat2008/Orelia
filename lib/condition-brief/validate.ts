/**
 * Deterministic validator for the Condition Brief. Everything the generator (LLM or fixture) proposes passes through
 * here before a patient sees it. Nothing is rewritten: an item is either kept (with its evidence level capped by
 * tagging policy) or dropped with a recorded reason.
 */
import { z } from "zod";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import {
  briefSourceSchema,
  briefStatementSchema,
  doctorQuestionSchema,
  prevalenceSchema,
  registryItemSchema,
  researchItemSchema,
  studyItemSchema,
  type BriefSource,
  type BriefSourceKind,
  type BriefStatement,
  type CollectedSources,
  type DoctorQuestion,
  type Prevalence,
  type RegistryItem,
  type ResearchItem,
  type StudyItem,
} from "./contract";
import { capLevel } from "./tagging";

export interface DroppedItem { id: string; reason: string }

export interface ValidatedBrief {
  statements: BriefStatement[];
  questions: DoctorQuestion[];
  prevalence: Prevalence[];
  studies: StudyItem[];
  research: ResearchItem[];
  registries: RegistryItem[];
  dropped: DroppedItem[];
}

/** Sources that may back a prevalence/rarity statement. */
export const RARITY_SOURCE_KINDS: readonly BriefSourceKind[] = ["orphanet", "gard", "nord", "genereviews", "medlineplus"];

/** Second-person / recommendation phrasing that never belongs in a factual statement. */
const DIRECTIVE_PATTERNS: readonly RegExp[] = [
  /\byou\s+(?:should|must|need to|have to|ought to|had better|may want to|might want to)\b/i,
  /\b(?:we|i)\s+(?:recommend|advise|suggest|urge)\b/i,
  /\bconsider\s+(?:taking|starting|stopping|trying|using|asking for|switching)\b/i,
  /\bit\s+is\s+(?:recommended|advisable)\s+(?:that\s+you|to)\b/i,
  /\b(?:make sure|be sure)\s+(?:you|to)\b/i,
  /\byour\s+(?:doctor|physician|care team)\s+(?:should|must|will)\b/i,
];

/** Dose amounts, schedules and per-weight dosing. */
const DOSE_PATTERNS: readonly RegExp[] = [
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|ug|ml|iu|milligrams?|micrograms?)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|units?)\s*(?:\/|per)\s*(?:kg|m2|m²|day|dose)\b/i,
  /\b(?:once|twice|three times)\s+(?:a|per)\s+day\b/i,
  /\bevery\s+\d+\s+hours\b/i,
];

const CONTACT_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/|www\./i;

/** Questions for the patient's own doctor must start like a question to them. */
const QUESTION_START = /^(?:is|are|was|were|what|which|when|where|who|why|how|could|would|can|do|does|did|will|might|may|has|have)\b/i;
const QUESTION_RECOMMENDATION: readonly RegExp[] = [
  /\bshould\s+(?:i|we|my|the patient)\b/i,
  /\b(?:i|we)\s+should\b/i,
  /\byou\s+(?:should|must)\b/i,
  /\b(?:we|i)\s+(?:recommend|advise|suggest)\b/i,
  /\b(?:start|begin|stop|discontinue|quit)\s+taking\b/i,
  /\bswitch(?:ing)?\s+to\b/i,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

/** Why a statement's text is not allowed, or null when it is. */
export function statementTextProblem(text: string): string | null {
  if (flagMedicalAdvice(text).flagged) return "medical advice or prognosis language";
  if (matchesAny(text, DIRECTIVE_PATTERNS)) return "second-person directive or recommendation";
  if (matchesAny(text, DOSE_PATTERNS)) return "dosing language";
  if (CONTACT_PATTERN.test(text)) return "contact details or links are not allowed in statements";
  return null;
}

/** Why a doctor question is not allowed, or null when it is. */
export function questionTextProblem(text: string): string | null {
  const t = text.trim();
  if (!t.endsWith("?")) return "not phrased as a question";
  if (!QUESTION_START.test(t)) return "not phrased as a question to the doctor";
  if (flagMedicalAdvice(t).flagged) return "medical advice language";
  if (matchesAny(t, QUESTION_RECOMMENDATION) || matchesAny(t, DIRECTIVE_PATTERNS)) return "embeds a recommendation";
  if (matchesAny(t, DOSE_PATTERNS)) return "names a dose";
  if (CONTACT_PATTERN.test(t)) return "contact details or links are not allowed in questions";
  return null;
}

/** Only sources that were actually fetched (schema-valid, url + fetchedAt present) can be cited. */
export function usableSources(sources: readonly unknown[]): Map<string, BriefSource> {
  const out = new Map<string, BriefSource>();
  for (const raw of sources) {
    const parsed = briefSourceSchema.safeParse(raw);
    if (parsed.success && parsed.data.url && parsed.data.fetchedAt && !out.has(parsed.data.id)) out.set(parsed.data.id, parsed.data);
  }
  return out;
}

const looseGeneratedSchema = z.object({
  statements: z.array(z.unknown()).default([]),
  questions: z.array(z.unknown()).default([]),
});

function rawId(raw: unknown, fallback: string): string {
  const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return typeof id === "string" && id.length > 0 ? id.slice(0, 80) : fallback;
}

function statementProblem(s: BriefStatement, sources: Map<string, BriefSource>, seen: Set<string>): string | null {
  if (seen.has(s.id)) return "duplicate id";
  if (s.sourceIds.length === 0) return "no sources";
  const unknown = s.sourceIds.find(id => !sources.has(id));
  if (unknown) return `cites a source that was not fetched (${unknown.slice(0, 120)})`;
  if (s.section === "rarity" && !s.sourceIds.some(id => RARITY_SOURCE_KINDS.includes(sources.get(id)!.kind))) {
    return "prevalence statement must cite Orphanet, GARD, NORD, GeneReviews or MedlinePlus";
  }
  return statementTextProblem(s.text);
}

function validateStatements(raws: unknown[], sources: Map<string, BriefSource>, dropped: DroppedItem[]): BriefStatement[] {
  const kept: BriefStatement[] = [];
  const seen = new Set<string>();
  raws.forEach((raw, i) => {
    const parsed = briefStatementSchema.safeParse(raw);
    if (!parsed.success) {
      const ids = typeof raw === "object" && raw !== null ? (raw as { sourceIds?: unknown }).sourceIds : undefined;
      const unsourced = !Array.isArray(ids) || ids.length === 0;
      dropped.push({ id: rawId(raw, `statement#${i}`), reason: unsourced ? "no sources" : "invalid statement shape" });
      return;
    }
    const s = { ...parsed.data, sourceIds: [...new Set(parsed.data.sourceIds)] };
    const problem = statementProblem(s, sources, seen);
    if (problem) {
      dropped.push({ id: s.id, reason: problem });
      return;
    }
    seen.add(s.id);
    kept.push({ ...s, evidenceLevel: capLevel(s.evidenceLevel, s.sourceIds.map(id => sources.get(id)!)) });
  });
  return kept;
}

function validateQuestions(raws: unknown[], keptStatementIds: Set<string>, dropped: DroppedItem[]): DoctorQuestion[] {
  const kept: DoctorQuestion[] = [];
  const seen = new Set<string>();
  raws.forEach((raw, i) => {
    const parsed = doctorQuestionSchema.safeParse(raw);
    if (!parsed.success) {
      dropped.push({ id: rawId(raw, `question#${i}`), reason: "invalid question shape" });
      return;
    }
    const q = parsed.data;
    const problem = seen.has(q.id) ? "duplicate id" : questionTextProblem(q.text);
    if (problem) {
      dropped.push({ id: q.id, reason: problem });
      return;
    }
    seen.add(q.id);
    const statementIds = [...new Set(q.statementIds)].filter(id => keptStatementIds.has(id));
    kept.push({ ...q, text: q.text.trim(), statementIds });
  });
  return kept;
}

/** Keep collector-derived items only when they parse and reference a fetched source. */
function keepReferenced<T extends { sourceId: string }>(
  items: readonly unknown[],
  schema: z.ZodType<T>,
  label: string,
  sources: Map<string, BriefSource>,
  dropped: DroppedItem[],
  adjust: (item: T, source: BriefSource) => T = item => item,
): T[] {
  const kept: T[] = [];
  const seen = new Set<string>();
  items.forEach((raw, i) => {
    const parsed = schema.safeParse(raw);
    const id = `${label}:${typeof raw === "object" && raw !== null && typeof (raw as { sourceId?: unknown }).sourceId === "string" ? (raw as { sourceId: string }).sourceId.slice(0, 120) : `#${i}`}`;
    if (!parsed.success) return void dropped.push({ id, reason: `invalid ${label} item` });
    const source = sources.get(parsed.data.sourceId);
    if (!source) return void dropped.push({ id, reason: `${label} item references a source that was not fetched` });
    const key = JSON.stringify(parsed.data);
    if (seen.has(key)) return;
    seen.add(key);
    kept.push(adjust(parsed.data, source));
  });
  return kept;
}

const capItem = <T extends { evidenceLevel: StudyItem["evidenceLevel"] }>(item: T, source: BriefSource): T =>
  ({ ...item, evidenceLevel: capLevel(item.evidenceLevel, [source]) });

/** Validate the collector-derived lists (no generator involved). */
export function validateCollected(collected: CollectedSources, dropped: DroppedItem[] = []): Omit<ValidatedBrief, "statements" | "questions"> {
  const sources = usableSources(collected.sources);
  return {
    prevalence: keepReferenced(collected.prevalence, prevalenceSchema, "prevalence", sources, dropped),
    studies: keepReferenced(collected.studies, studyItemSchema, "study", sources, dropped, capItem),
    research: keepReferenced(collected.research, researchItemSchema, "research", sources, dropped, capItem),
    registries: keepReferenced(collected.registries, registryItemSchema, "registry", sources, dropped),
    dropped,
  };
}

/**
 * Validate generator output against what was actually collected. Deterministic: same input, same output.
 * Returns kept statements/questions, the validated collector lists, and every drop with its reason.
 */
export function validateBrief(generated: unknown, collected: CollectedSources): ValidatedBrief {
  const dropped: DroppedItem[] = [];
  const sources = usableSources(collected.sources);
  const loose = looseGeneratedSchema.safeParse(generated ?? {});
  if (!loose.success) dropped.push({ id: "generated", reason: "generator output was not a valid brief" });
  const raw = loose.success ? loose.data : { statements: [], questions: [] };
  const statements = validateStatements(raw.statements, sources, dropped);
  const questions = validateQuestions(raw.questions, new Set(statements.map(s => s.id)), dropped);
  const collectedLists = validateCollected(collected, dropped);
  return { ...collectedLists, statements, questions, dropped };
}
