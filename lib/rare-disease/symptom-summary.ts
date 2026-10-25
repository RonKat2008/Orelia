/**
 * Symptom summary for the undiagnosed path. Deterministic and EXTRACTIVE: every quote is a sentence copied verbatim
 * from the patient's own answers or their documents, with a citation. No model, no paraphrase, no interpretation.
 * Sentences that guess or name a diagnosis, or read as medical advice, are dropped; text from diagnosis events is
 * never used.
 */
import type { HistoryDocument, HistoryEvent } from "@/lib/history";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import { flagDiagnosisGuess } from "./no-diagnosis";

export const MAX_SYMPTOM_QUOTES = 8;
const MIN_QUOTE_CHARS = 6;
const MAX_QUOTE_CHARS = 400;

export interface SymptomCitation {
  label: string;
  href: string;
}

export interface SymptomQuote {
  text: string;
  citation: SymptomCitation;
}

export interface SymptomSummary {
  quotes: SymptomQuote[];
}

export interface SymptomSummaryInput {
  caseId: string;
  symptomNotes?: string;
  documents: readonly HistoryDocument[];
  events: readonly HistoryEvent[];
}

/** Words that describe a symptom or a day-to-day problem. A sentence needs one to be quoted. */
const SYMPTOM_CUES =
  /\b(?:pain\w*|aches?|aching|hurts?|hurting|sore\w*|tired\w*|fatigue\w*|exhaust\w*|weak\w*|numb\w*|tingl\w*|dizz\w*|faint\w*|swell\w*|swollen|rash\w*|bruis\w*|bleed\w*|fevers?|nause\w*|vomit\w*|cough\w*|breath\w*|seizures?|headaches?|migraines?|cramp\w*|stiff\w*|joints?|dislocat\w*|trouble|problems?|difficult\w*|struggl\w*|falls?|falling|fell|blurr\w*|vision|hearing|itch\w*|sweat\w*|palpitat\w*|racing|insomnia|diarrh\w*|constipat\w*|symptoms?|flares?|spasms?|tremors?|shak\w*|weight loss|lost weight|can't|cannot|hard to)\b/i;

/** Hedged guesses ("it could be ...", "I think I have ...") are dropped even when no condition is named. */
const HEDGE = /\b(?:could|might|may)\s+be\b|\bi\s+think\s+(?:i|it)\b|\bmaybe\b/i;

interface Span {
  text: string;
  start: number;
  end: number;
}

/** Sentences with their [start, end) offsets in the source text (trimmed, verbatim). */
function sentenceSpans(text: string): Span[] {
  return [...text.matchAll(/[^.!?\n]+[.!?]*/g)].flatMap((m) => {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) return [];
    const start = (m.index ?? 0) + lead;
    return [{ text: trimmed, start, end: start + trimmed.length }];
  });
}

function quotable(sentence: string): boolean {
  if (sentence.length < MIN_QUOTE_CHARS || sentence.length > MAX_QUOTE_CHARS) return false;
  if (!SYMPTOM_CUES.test(sentence) || HEDGE.test(sentence)) return false;
  return !flagDiagnosisGuess(sentence).flagged && !flagMedicalAdvice(sentence).flagged;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

function docCitation(caseId: string, doc: HistoryDocument): SymptomCitation {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(doc.createdAt)?.[0];
  return { label: date ? `${doc.title}, ${date}` : doc.title, href: `/cases/${encodeURIComponent(caseId)}/history` };
}

function fromNotes(input: SymptomSummaryInput): SymptomQuote[] {
  const notes = input.symptomNotes ?? "";
  const citation = { label: "Your answers", href: `/cases/${encodeURIComponent(input.caseId)}/documents` };
  return sentenceSpans(notes).filter((s) => quotable(s.text)).map((s) => ({ text: s.text, citation }));
}

function fromDocument(input: SymptomSummaryInput, doc: HistoryDocument): SymptomQuote[] {
  const events = input.events.filter((e) => e.sourceDocId === doc.id);
  const blocked = events.filter((e) => e.kind === "diagnosis").map((e) => e.span);
  const citation = docCitation(input.caseId, doc);
  const sentences = sentenceSpans(doc.text)
    .filter((s) => !blocked.some((b) => overlaps(s, b)) && quotable(s.text))
    .map((s) => ({ text: s.text, citation }));
  const findings = events
    .filter((e) => e.kind !== "diagnosis")
    .flatMap((e) => e.findings.map((f) => f.trim()))
    .filter((f) => {
      const at = doc.text.indexOf(f);
      return at >= 0 && !blocked.some((b) => overlaps({ start: at, end: at + f.length }, b)) && quotable(f);
    })
    .map((text) => ({ text, citation }));
  return [...sentences, ...findings];
}

const dedupeKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Build the summary: the patient's own words first, then each document in order. Pure. */
export function buildSymptomSummary(input: SymptomSummaryInput): SymptomSummary {
  const all = [...fromNotes(input), ...input.documents.flatMap((d) => fromDocument(input, d))];
  const seen = new Set<string>();
  const quotes = all.filter((q) => {
    const key = dedupeKey(q.text);
    if (seen.has(key) || [...seen].some((k) => k.includes(key) || key.includes(k))) return false;
    seen.add(key);
    return true;
  });
  return { quotes: quotes.slice(0, MAX_SYMPTOM_QUOTES) };
}
