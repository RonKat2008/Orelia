/**
 * "Your condition" card facts. Every fact is computed in code from the case, the condition brief and the final judge
 * result, and every fact carries the link to where it came from. Nothing without a source is shown: a prevalence
 * figure needs a fetched source, a code needs a strict format, a distance needs the candidate's evidence link.
 * For an undiagnosed case the card never names or codes a condition.
 */
import type { Case } from "@/lib/contracts/case";
import type { ConditionBrief } from "@/lib/condition-brief/contract";
import type { JudgeResult } from "@/lib/contracts/judge";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";

export type CodeSystem = "orpha" | "omim" | "mesh" | "icd10";
export type FactKind = "name" | "code" | "prevalence" | "experts" | "centers" | "nearest";

export interface FactSource {
  /** Short name of the source ("Orphanet", "Your case details", "Your list"). */
  label: string;
  /** Absolute https URL, or an in-app path that starts with /cases/. */
  href: string;
}

export interface ConditionFact {
  kind: FactKind;
  id: string;
  /** Dense label for the judge view. */
  label: string;
  /** The value as the source states it (judge view, and the quoted prevalence label). */
  value: string;
  /** Plain sentence for the patient view, when one can be written from the value alone. */
  plain?: string;
  source: FactSource;
  system?: CodeSystem;
  count?: number;
  miles?: number;
  travelLimitMiles?: number;
  withinTravelLimit?: boolean;
}

export interface ConditionCard {
  caseId: string;
  undiagnosed: boolean;
  facts: ConditionFact[];
}

export interface ConditionCardInput {
  caseId: string;
  case: Pick<Case, "diseaseName"> & Partial<Pick<Case, "diseaseCodes" | "undiagnosed">>;
  brief: ConditionBrief | null;
  judge: JudgeResult | null;
}

export const NO_DIAGNOSIS_LABEL = "No diagnosis yet";

/** Patient sentences the builder writes (scored by tests/rare-ui readability). */
export const CONDITION_FACT_COPY = {
  experts: (n: number) =>
    n === 1 ? "We found 1 specialist who knows your condition." : `We found ${n} specialists who know your condition.`,
  centers: (n: number) => (n === 1 ? "We found 1 care center for it." : `We found ${n} care centers for it.`),
  nearestWithin: (miles: number, limit: number) =>
    `The closest one is about ${miles} miles away. That is within the ${limit} miles you can travel.`,
  nearestBeyond: (miles: number, limit: number) =>
    `The closest one is about ${miles} miles away. That is more than the ${limit} miles you can travel.`,
  estimate: "This is a rough guess from state to state.",
  prevalenceAbout: (low: string, high: string, per: string) => `About ${low} to ${high} in every ${per} people have it.`,
  prevalenceOne: (n: string, per: string) => `About ${n} in every ${per} people have it.`,
  prevalenceFewer: (n: string, per: string) => `Fewer than ${n} in every ${per} people have it.`,
  prevalenceMore: (n: string, per: string) => `More than ${n} in every ${per} people have it.`,
} as const;

const CODE_RULES: Record<CodeSystem, { pattern: RegExp; label: string; source: string; url: (id: string) => string; show: (id: string) => string }> = {
  orpha: { pattern: /^(?:ORPHA:?)?(\d{1,7})$/i, label: "ORPHA", source: "Orphanet", url: (id) => `https://www.orpha.net/en/disease/detail/${id}`, show: (id) => `ORPHA:${id}` },
  omim: { pattern: /^(?:OMIM:?)?(\d{6})$/i, label: "OMIM", source: "OMIM", url: (id) => `https://omim.org/entry/${id}`, show: (id) => id },
  mesh: { pattern: /^(?:MESH:?)?([CD]\d{6}(?:\d{3})?)$/i, label: "MeSH", source: "MeSH", url: (id) => `https://meshb.nlm.nih.gov/record/ui?ui=${id}`, show: (id) => id },
  icd10: { pattern: /^([A-TV-Z]\d{2}(?:\.\d{1,4})?)$/i, label: "ICD-10", source: "WHO ICD-10", url: (id) => `https://icd.who.int/browse10/2019/en#/${id}`, show: (id) => id },
};
const CODE_ORDER: readonly CodeSystem[] = ["orpha", "omim", "mesh", "icd10"];

function normalizeCode(system: CodeSystem, raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const m = CODE_RULES[system].pattern.exec(raw);
  return m ? m[1].toUpperCase() : null;
}

/** The registry page for a code, or null when the code is not in the strict format for its system. */
export function codeLink(system: CodeSystem, raw: string | null | undefined): string | null {
  const id = normalizeCode(system, raw);
  return id ? CODE_RULES[system].url(id) : null;
}

const PREVALENCE_LABEL = /^(?:(\d+)\s*-\s*(\d+)|([<>])\s*(\d+)|(\d+))\s*\/\s*(\d{1,3}(?:[ ,]?\d{3})*)$/;

/**
 * A plain reading of an Orphanet-style label ("1-9 / 100 000"), or null unless it parses cleanly. Only for
 * prevalence figures: a case count or a yearly incidence is not a share of people.
 */
export function plainPrevalence(label: string, prevalenceType?: string): string | null {
  if (prevalenceType && !/prevalence/i.test(prevalenceType)) return null;
  const m = PREVALENCE_LABEL.exec(label.trim());
  if (!m) return null;
  const per = Number(m[6].replace(/[ ,]/g, ""));
  if (!Number.isSafeInteger(per) || per < 10) return null;
  const perText = per.toLocaleString("en-US");
  if (m[1] && m[2]) {
    const [low, high] = [Number(m[1]), Number(m[2])];
    if (low < 1 || high <= low) return null;
    return CONDITION_FACT_COPY.prevalenceAbout(String(low), String(high), perText);
  }
  if (m[3] && m[4]) {
    return m[3] === "<" ? CONDITION_FACT_COPY.prevalenceFewer(m[4], perText) : CONDITION_FACT_COPY.prevalenceMore(m[4], perText);
  }
  return m[5] && Number(m[5]) >= 1 ? CONDITION_FACT_COPY.prevalenceOne(m[5], perText) : null;
}

const isHttps = (url: string) => /^https:\/\/[^\s]+$/i.test(url);
const documentsHref = (caseId: string) => `/cases/${encodeURIComponent(caseId)}/documents`;
const shortlistHref = (caseId: string) => `/cases/${encodeURIComponent(caseId)}/shortlist`;

function nameFact(input: ConditionCardInput, undiagnosed: boolean): ConditionFact {
  if (undiagnosed) {
    return { kind: "name", id: "name", label: "Condition", value: NO_DIAGNOSIS_LABEL, plain: NO_DIAGNOSIS_LABEL, source: { label: "Your answers", href: documentsHref(input.caseId) } };
  }
  const orphanet = input.brief?.sources.find((s) => s.kind === "orphanet" && isHttps(s.url));
  const source = orphanet ? { label: "Orphanet", href: orphanet.url } : { label: "Your case details", href: documentsHref(input.caseId) };
  const value = input.case.diseaseName.trim();
  return { kind: "name", id: "name", label: "Condition", value, plain: value, source };
}

function codeFacts(input: ConditionCardInput): ConditionFact[] {
  const codes = input.case.diseaseCodes ?? {};
  return CODE_ORDER.flatMap((system) => {
    const id = normalizeCode(system, codes[system]);
    if (!id) return [];
    const rule = CODE_RULES[system];
    return [{ kind: "code" as const, id: `code-${system}`, system, label: rule.label, value: rule.show(id), source: { label: rule.source, href: rule.url(id) } }];
  });
}

function prevalenceFact(brief: ConditionBrief | null): ConditionFact[] {
  if (!brief) return [];
  const sourced = brief.prevalence.flatMap((p) => {
    const source = brief.sources.find((s) => s.id === p.sourceId && isHttps(s.url));
    if (!source || flagMedicalAdvice(p.label).flagged) return [];
    return [{ p, source, plain: plainPrevalence(p.label, p.prevalenceType) }];
  });
  const best = sourced.find((s) => s.plain) ?? sourced[0];
  if (!best) return [];
  const label = best.p.prevalenceType ? `Prevalence (${best.p.prevalenceType.toLowerCase()})` : "Prevalence";
  return [{
    kind: "prevalence",
    id: "prevalence",
    label,
    value: best.p.label,
    ...(best.plain ? { plain: best.plain } : {}),
    source: { label: best.source.publisher ?? best.source.title, href: best.source.url },
  }];
}

const counted = (judge: JudgeResult, kind: "expert" | "institution") =>
  judge.judgements.filter((j) => j.kind === kind && (j.verdict === "keep" || j.verdict === "maybe")).length;

export interface NearestCare {
  name: string;
  miles: number;
  travelLimitMiles: number;
  withinTravelLimit: boolean;
  /** The candidate's first evidence link. */
  href: string;
}

/** The nearest kept or maybe expert or center with code-computed travel facts and an evidence link. */
export function nearestCare(judge: JudgeResult | null): NearestCare | null {
  if (!judge) return null;
  const located = judge.judgements.flatMap((j) => {
    const miles = j.travel?.nearestMiles;
    const href = j.links.find((l) => isHttps(l.url))?.url;
    const fits = (j.kind === "expert" || j.kind === "institution") && (j.verdict === "keep" || j.verdict === "maybe");
    if (!fits || typeof miles !== "number" || !href || !j.travel) return [];
    const limit = j.travel.travelLimitMiles;
    return [{ name: j.name, miles, travelLimitMiles: limit, withinTravelLimit: j.travel.withinTravelLimit ?? miles <= limit, href, order: j.order }];
  });
  const [best] = [...located].sort((a, b) => a.miles - b.miles || a.order - b.order);
  if (!best) return null;
  const { order: _order, ...rest } = best;
  void _order;
  return rest;
}

function judgeFacts(caseId: string, judge: JudgeResult | null): ConditionFact[] {
  if (!judge) return [];
  const list = { label: "Your list", href: shortlistHref(caseId) };
  const experts = counted(judge, "expert");
  const centers = counted(judge, "institution");
  const facts: ConditionFact[] = [
    { kind: "experts", id: "experts", label: "Experts found", value: String(experts), count: experts, plain: CONDITION_FACT_COPY.experts(experts), source: list },
    { kind: "centers", id: "centers", label: "Centers found", value: String(centers), count: centers, plain: CONDITION_FACT_COPY.centers(centers), source: list },
  ];
  const near = nearestCare(judge);
  if (!near) return facts;
  const sentence = near.withinTravelLimit ? CONDITION_FACT_COPY.nearestWithin : CONDITION_FACT_COPY.nearestBeyond;
  return [...facts, {
    kind: "nearest",
    id: "nearest",
    label: "Nearest expert",
    value: `${near.miles} mi (limit ${near.travelLimitMiles} mi), state-to-state estimate`,
    plain: `${sentence(near.miles, near.travelLimitMiles)} ${CONDITION_FACT_COPY.estimate}`,
    miles: near.miles,
    travelLimitMiles: near.travelLimitMiles,
    withinTravelLimit: near.withinTravelLimit,
    source: { label: near.name, href: near.href },
  }];
}

/** Build the card. Pure: reads its input, never changes it. */
export function buildConditionCard(input: ConditionCardInput): ConditionCard {
  const undiagnosed = input.case.undiagnosed === true;
  const facts = [
    nameFact(input, undiagnosed),
    ...(undiagnosed ? [] : codeFacts(input)),
    ...(undiagnosed ? [] : prevalenceFact(input.brief)),
    ...judgeFacts(input.caseId, input.judge),
  ];
  return { caseId: input.caseId, undiagnosed, facts };
}
