/**
 * Deterministic extraction of packet sections from the patient's own history text. No model, no advice, no
 * interpretation: lines are copied (sanitized) and ranked by keyword overlap with the specialist.
 */
import { neutralizeUntrusted } from '@/lib/agents/research/untrusted';
import type { PacketItem, PacketSection, PacketSectionKey, ReferralRequirement } from '../contract';
import type { HistoryDocument } from './history';

export const SECTION_TITLES: Record<PacketSectionKey, string> = {
  summary: 'Summary',
  timeline: 'Timeline',
  tests: 'Key test results',
  conflicts: 'Records that differ',
  questions: 'Questions for this practice',
  requirements: 'Referral requirements',
};
export const SECTION_ORDER: readonly PacketSectionKey[] = ['summary', 'timeline', 'tests', 'conflicts', 'questions', 'requirements'];
/** Ticked by default: the three sections that are the patient's own history. The rest are opt-in. */
export const DEFAULT_INCLUDED: Record<PacketSectionKey, boolean> = {
  summary: true, timeline: true, tests: true, conflicts: false, questions: false, requirements: false,
};
/** Neutral, process-only questions. Never advice, never about treatment. */
export const TEMPLATE_QUESTIONS: readonly string[] = [
  'Is a referral letter required before a first appointment, and who should send it?',
  'Which records would you like us to send in advance, and in what format?',
  'Do you offer a physician-to-physician e-consult or case review?',
  'Is insurance pre-authorization or verification needed, and who starts it?',
  'What is the usual wait for a first appointment, and how can I be added to a cancellation list?',
];
export const MAX_PATIENT_QUESTIONS = 10;

const LIMITS = { summary: 5, timeline: 25, tests: 20, conflicts: 15, requirements: 30 } as const;
const MAX_LINE = 400;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were', 'center', 'centre', 'clinic', 'hospital', 'department', 'university', 'health', 'medical', 'patient', 'patients', 'care', 'dr', 'md']);

// ------------------------------------------------------------------ helpers

/** One sanitized, length-capped line; undefined when nothing meaningful is left. */
export function cleanLine(raw: string): string | undefined {
  const t = neutralizeUntrusted(stripMarkdown(raw)).replace(/^[\s\-*•·]+/, '').trim();
  if (t.length < 4) return undefined;
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE - 1)}…` : t;
}

/** Pasted records are often Markdown: drop heading/quote markers and bold/italic/code markers, keep the words. */
function stripMarkdown(raw: string): string {
  return raw.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/, '').replace(/(\*\*|__|`)/g, '');
}

/** A Markdown heading line: a record or section title (often carries the patient's name), not summary content. */
export function isMarkdownHeading(raw: string): boolean {
  return /^\s{0,3}#{1,6}\s/.test(raw);
}

export function linesOf(text: string): string[] {
  return text.split(/\r?\n/).flatMap(l => (l.length > 600 ? l.split(/(?<=[.;])\s+/) : [l]));
}

export function keywordsFor(name: string, claims: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const w of `${name} ${claims.join(' ')}`.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w);
  return out;
}

export function relevance(text: string, keywords: ReadonlySet<string>): number {
  if (keywords.size === 0) return 0;
  const words = new Set(text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []);
  let n = 0;
  for (const k of keywords) if (words.has(k)) n++;
  return n;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}
const DATE_RES: { re: RegExp; to: (m: RegExpExecArray) => string | null }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, to: m => iso(+m[1], +m[2], +m[3]) },
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, to: m => iso(+m[3], +m[1], +m[2]) },
  { re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi, to: m => iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]) },
];

export interface FoundDate { date: string; index: number; length: number }
export function findDates(line: string): FoundDate[] {
  const out: FoundDate[] = [];
  for (const { re, to } of DATE_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const date = to(m);
      if (date) out.push({ date, index: m.index, length: m[0].length });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const TEST_UNIT = /\d+(?:\.\d+)?\s?(?:mg\/dl|g\/dl|ng\/ml|pg\/ml|ug\/l|µg\/l|mmol\/l|meq\/l|iu\/l|u\/l|k\/ul|x10\^?\d+\/l|%|mm\s?hg|bpm|cm|mm|ml|kg)\b/i;
const TEST_WORD = /\b(?:mri|ct|pet|biopsy|ecg|ekg|echocardiogram|x-ray|ultrasound|panel|sequencing|genotype|genetic|variant|mutation|karyotype|culture|titer|antibod\w*|hemoglobin|creatinine|ferritin|platelets?|wbc|egfr|a1c|lab(?:s| result\w*)?|result\w*)\b/i;
const TEST_CATEGORICAL = /\b(?:positive|negative|detected|not detected|normal|abnormal|pathogenic|likely pathogenic|benign|variant of uncertain significance)\b/i;
export function isTestLine(line: string): boolean {
  return TEST_UNIT.test(line) || (TEST_WORD.test(line) && (/\d/.test(line) || TEST_CATEGORICAL.test(line))) || (/:/.test(line) && TEST_CATEGORICAL.test(line));
}

// ------------------------------------------------------------------ conflicts

interface Fact { label: string; value: string; docId: string; docTitle: string; date: string | null }

const KV = /(?:^|[\s,;(])([A-Za-z][A-Za-z0-9 /().-]{2,40}?)\s*(?::|=|\bis\b|\bwas\b)\s*(\d+(?:\.\d+)?\s?(?:mg\/dl|g\/dl|ng\/ml|pg\/ml|mmol\/l|iu\/l|u\/l|k\/ul|%|mm\s?hg|bpm|cm|mm|ml|kg)?|positive|negative|not detected|detected|normal|abnormal|pathogenic|likely pathogenic|benign)(?![-/]\d)\b/gi;
const EVENT = /\b(diagnos(?:is|ed)|biopsy|surgery|onset|symptom onset|first seen)\b[^.\n]{0,50}?/gi;

function normLabel(l: string): string {
  return l.toLowerCase().replace(/\b(?:result|level|value|the|test)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normValue(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '').replace(/^notdetected$/, 'not detected');
}

function collectFacts(docs: readonly HistoryDocument[]): { kv: Fact[]; events: Fact[] } {
  const kv: Fact[] = [];
  const events: Fact[] = [];
  for (const doc of docs) {
    for (const raw of linesOf(doc.text)) {
      const line = cleanLine(raw);
      if (!line) continue;
      const dates = findDates(line);
      const lineDate = dates[0]?.date ?? null;
      KV.lastIndex = 0;
      for (let m = KV.exec(line); m; m = KV.exec(line)) {
        const label = normLabel(m[1]);
        if (label.length >= 3 && !/\d{4}/.test(label)) kv.push({ label, value: m[2].trim(), docId: doc.id, docTitle: doc.title, date: lineDate });
      }
      EVENT.lastIndex = 0;
      for (let m = EVENT.exec(line); m; m = EVENT.exec(line)) {
        const after = findDates(line.slice(m.index)).find(d => d.index <= 70);
        if (after) events.push({ label: m[1].toLowerCase().replace(/^diagnos.*/, 'diagnosis'), value: after.date, docId: doc.id, docTitle: doc.title, date: after.date });
      }
    }
  }
  return { kv, events };
}

const dateWord = (d: string | null) => (d ? ` (dated ${d})` : '');

/**
 * Contradictions across DIFFERENT documents: the same named result with a different value on the same (or an unstated)
 * date, or the same event with different dates. Repeated values on different dates are a trend, not a conflict.
 * Wording is neutral ("records differ"), never an interpretation of which is right.
 */
export function detectConflicts(docs: readonly HistoryDocument[], keywords: ReadonlySet<string> = new Set()): PacketItem[] {
  const { kv, events } = collectFacts(docs);
  const found: { item: PacketItem; score: number }[] = [];
  const seen = new Set<string>();

  const push = (text: string, a: Fact, label: string) => {
    if (seen.has(text)) return;
    seen.add(text);
    found.push({ item: { text: text.slice(0, 1200), date: null, sourceDocId: a.docId, sourceUrl: null }, score: relevance(label, keywords) });
  };

  const byLabel = new Map<string, Fact[]>();
  for (const f of kv) byLabel.set(f.label, [...(byLabel.get(f.label) ?? []), f]);
  for (const [label, facts] of byLabel) {
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const a = facts[i], b = facts[j];
        if (a.docId === b.docId || normValue(a.value) === normValue(b.value)) continue;
        if (a.date && b.date && a.date !== b.date) continue;
        push(`Records differ on "${label}": ${a.value}${dateWord(a.date)} in ${a.docTitle} vs ${b.value}${dateWord(b.date)} in ${b.docTitle}.`, a, label);
      }
    }
  }
  const byEvent = new Map<string, Fact[]>();
  for (const f of events) byEvent.set(f.label, [...(byEvent.get(f.label) ?? []), f]);
  for (const [label, facts] of byEvent) {
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const a = facts[i], b = facts[j];
        if (a.docId === b.docId || a.value === b.value) continue;
        push(`Records give different dates for ${label}: ${a.value} in ${a.docTitle} vs ${b.value} in ${b.docTitle}.`, a, label);
      }
    }
  }
  return found.sort((x, y) => y.score - x.score).slice(0, LIMITS.conflicts).map(f => f.item);
}

// ------------------------------------------------------------------ sections

export interface BuildInput {
  name: string;
  claims: readonly string[];
  docs: readonly HistoryDocument[];
  requirements: readonly ReferralRequirement[];
  /** Patient-entered questions to keep (already validated). */
  patientQuestions: readonly string[];
  /** Conflicts found by the medical-history lane; listed first, then text-detected ones (deduped). */
  historyConflicts?: readonly PacketItem[];
}

const STATUS_TEXT: Record<ReferralRequirement['status'], string> = {
  have: 'have it', missing: 'still needed', patient_to_request: 'patient to request', unknown: 'not checked yet',
};

function mergeConflicts(fromHistory: readonly PacketItem[], detected: readonly PacketItem[]): PacketItem[] {
  const seen = new Set<string>();
  return [...fromHistory, ...detected].filter(i => (seen.has(i.text) ? false : (seen.add(i.text), true))).slice(0, LIMITS.conflicts);
}

export function buildSections(input: BuildInput, previousIncluded?: Partial<Record<PacketSectionKey, boolean>>): PacketSection[] {
  const keywords = keywordsFor(input.name, input.claims);
  const summary: PacketItem[] = [];
  const timeline: (PacketItem & { score: number; order: number })[] = [];
  const tests: { item: PacketItem; score: number; order: number }[] = [];
  let order = 0;
  const seenLines = new Set<string>();

  input.docs.forEach((doc, docIndex) => {
    let firstLines = 0;
    for (const raw of linesOf(doc.text)) {
      const line = cleanLine(raw);
      if (!line) continue;
      const dedupe = `${doc.id}\u0000${line}`;
      if (seenLines.has(dedupe)) continue;
      seenLines.add(dedupe);
      order++;
      if (docIndex === 0 && firstLines < LIMITS.summary && !isMarkdownHeading(raw) && !/^\w[\w ]{0,30}:\s*$/.test(line)) { summary.push({ text: line, date: null, sourceDocId: doc.id, sourceUrl: null }); firstLines++; }
      const date = findDates(line)[0]?.date ?? null;
      const score = relevance(line, keywords);
      if (date) timeline.push({ text: line, date, sourceDocId: doc.id, sourceUrl: null, score, order });
      if (isTestLine(line)) tests.push({ item: { text: line, date, sourceDocId: doc.id, sourceUrl: null }, score, order });
    }
  });

  const topTimeline = [...timeline].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, LIMITS.timeline)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.order - b.order))
    .map(({ text, date, sourceDocId, sourceUrl }) => ({ text, date, sourceDocId, sourceUrl }));
  const topTests = [...tests].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, LIMITS.tests).map(t => t.item);

  const requirements: PacketItem[] = input.requirements.slice(0, LIMITS.requirements).map(r => ({
    text: `${r.label} [${STATUS_TEXT[r.status]}]${r.detail ? ` - ${r.detail}` : ''}`.slice(0, 1200),
    date: null, sourceDocId: r.matchedDocId, sourceUrl: r.sourceUrl,
  }));
  const questions: PacketItem[] = [
    ...input.patientQuestions.map(q => ({ text: q, date: null, sourceDocId: null, sourceUrl: null })),
    ...TEMPLATE_QUESTIONS.map(q => ({ text: q, date: null, sourceDocId: null, sourceUrl: null })),
  ];

  const itemsFor: Record<PacketSectionKey, PacketItem[]> = {
    summary, timeline: topTimeline, tests: topTests, conflicts: mergeConflicts(input.historyConflicts ?? [], detectConflicts(input.docs, keywords)), questions, requirements,
  };
  return SECTION_ORDER.map(key => ({
    key, title: SECTION_TITLES[key], items: itemsFor[key], included: previousIncluded?.[key] ?? DEFAULT_INCLUDED[key],
  }));
}

/** Patient-entered questions = question items that are not one of the neutral templates. */
export function patientQuestionsOf(sections: readonly PacketSection[]): string[] {
  const templates = new Set(TEMPLATE_QUESTIONS);
  return (sections.find(s => s.key === 'questions')?.items ?? []).map(i => i.text).filter(t => !templates.has(t));
}

/** Free text typed by the patient: strip control/invisible characters only; the outbound gate reviews it again. */
export function cleanPatientQuestion(q: string): string {
  return q.normalize('NFKC').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g, '').replace(/\s+/g, ' ').trim();
}
