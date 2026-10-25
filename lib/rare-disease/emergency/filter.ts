/**
 * Pure line filter for the emergency card. A line survives only when it (1) passes flagMedicalAdvice, (2) does not
 * read as an instruction to the patient, (3) resolves to a source (a fetched URL or one of the patient's own
 * documents) and, for undiagnosed cases, (4) does not guess or name a condition. The filter biases toward dropping.
 */
import { flagMedicalAdvice } from '@/lib/safety/no-medical-advice';
import { flagDiagnosisGuess } from '@/lib/rare-disease/no-diagnosis';
import type { HistoryDocument, HistoryEvent } from '@/lib/history/contract';
import {
  EMERGENCY_HEADER,
  type CardContent, type CardInputs, type DropReason, type DroppedLine, type FactLine, type NeedsForCard, type RecordLine,
} from './contract';

const SECOND_PERSON = /\byou(?:r|rs|rself|'re|'ll|'ve|'d)?\b/i;
const MODAL = /\b(?:should|must|ought to|needs? to|have to|has to|had better|are advised|is advised|it is (?:best|wise|important|essential|vital|critical)|(?:is|are) (?:important|essential|vital|critical) to)\b/i;
const EMERGENCY_DIRECTIVE = /\b(?:call|dial)\s+(?:911|999|112|an ambulance|emergency)|\bgo\s+(?:to\s+)?(?:the\s+)?(?:er|emergency|hospital)\b|\bseek\b|\bplease\b|\bmake sure\b|\bbe sure\b|\bdo not\b|\bdon'?t\b/i;
const IMPERATIVE_VERBS = new Set([
  'call', 'dial', 'seek', 'take', 'avoid', 'go', 'get', 'do', 'dont', 'never', 'always', 'tell', 'ask', 'carry', 'wear',
  'keep', 'make', 'stop', 'start', 'use', 'bring', 'contact', 'see', 'visit', 'check', 'remember', 'consider', 'try',
  'follow', 'inform', 'show', 'notify', 'request', 'insist', 'refuse', 'monitor', 'watch', 'rest', 'drink', 'eat',
  'limit', 'protect', 'be', 'please', 'let', 'stay', 'consult', 'report', 'alert', 'head', 'return', 'wait', 'ensure',
  'discuss', 'schedule', 'have', 'give', 'apply', 'press', 'lie', 'sit', 'remove', 'skip', 'reduce', 'increase', 'refrain',
]);

/** First word of each clause (sentences, then comma/semicolon/colon parts), lowercased, apostrophes removed. */
function clauseStarts(text: string): string[] {
  return text.split(/[.!?;:,\n]+/)
    .map((clause) => clause.trim().replace(/^[^A-Za-z]+/, '').split(/\s+/)[0]?.toLowerCase().replace(/[’']/g, '') ?? '')
    .filter(Boolean);
}

/** True when the text addresses the patient or tells someone what to do. */
export function readsAsInstruction(text: string): boolean {
  const t = text.replace(/[‘’]/g, "'");
  if (SECOND_PERSON.test(t) || MODAL.test(t) || EMERGENCY_DIRECTIVE.test(t)) return true;
  return clauseStarts(t).some((word) => IMPERATIVE_VERBS.has(word));
}

/** Null when the text may be shown; otherwise why it is dropped. Sourcing is checked by the callers. */
export function screenText(text: string, opts: { checkDiagnosis: boolean; checkInstruction?: boolean }): DropReason | null {
  if (flagMedicalAdvice(text).flagged) return 'medical_advice';
  if (opts.checkInstruction !== false && readsAsInstruction(text)) return 'instruction';
  if (opts.checkDiagnosis && flagDiagnosisGuess(text).flagged) return 'diagnosis_guess';
  return null;
}

export function shortUrl(url: string): string {
  let short: string;
  try {
    const u = new URL(url);
    short = `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return url.slice(0, 48); }
  return short.length > 48 ? `${short.slice(0, 47)}…` : short;
}

interface Built<T> { kept: T[]; dropped: DroppedLine[] }

function buildFacts(needs: NeedsForCard | null, undiagnosed: boolean): Built<FactLine> {
  if (!needs || undiagnosed) return { kept: [], dropped: [] };
  const byId = new Map(needs.sources.map((s) => [s.id, s]));
  return needs.emergencyFacts.reduce<Built<FactLine>>((acc, fact) => {
    const sources = fact.evidenceIds.flatMap((id) => {
      const s = byId.get(id);
      return s ? [{ url: s.url, title: s.title, short: shortUrl(s.url) }] : [];
    });
    const reason = screenText(fact.text, { checkDiagnosis: false }) ?? (sources.length === 0 ? 'unsourced' : null);
    return reason
      ? { ...acc, dropped: [...acc.dropped, { id: fact.id, section: 'facts', text: fact.text, reason }] }
      : { ...acc, kept: [...acc.kept, { id: fact.id, text: fact.text, sources }] };
  }, { kept: [], dropped: [] });
}

function buildRecord(event: HistoryEvent, docTitle: string | undefined): Built<RecordLine> {
  const drop = (text: string, reason: DropReason): DroppedLine => ({ id: event.id, section: 'records', text, reason });
  if (!docTitle) return { kept: [], dropped: [drop(event.title, 'unsourced')] };
  const titleReason = screenText(event.title, { checkDiagnosis: false });
  if (titleReason) return { kept: [], dropped: [drop(event.title, titleReason)] };
  const screened = event.findings.map((text) => ({ text, reason: screenText(text, { checkDiagnosis: false }) }));
  const line: RecordLine = {
    id: event.id, kind: event.kind as RecordLine['kind'], title: event.title, docTitle, date: event.date,
    findings: screened.filter((f) => !f.reason).map((f) => f.text),
  };
  return { kept: [line], dropped: screened.flatMap((f) => (f.reason ? [drop(f.text, f.reason)] : [])) };
}

function buildRecords(events: readonly HistoryEvent[], documents: readonly Pick<HistoryDocument, 'id' | 'title'>[], undiagnosed: boolean): Built<RecordLine> {
  const kinds = undiagnosed ? ['genetic_test'] : ['diagnosis', 'genetic_test'];
  const titles = new Map(documents.map((d) => [d.id, d.title]));
  return events.filter((e) => kinds.includes(e.kind)).reduce<Built<RecordLine>>((acc, event) => {
    const r = buildRecord(event, titles.get(event.sourceDocId));
    return { kept: [...acc.kept, ...r.kept], dropped: [...acc.dropped, ...r.dropped] };
  }, { kept: [], dropped: [] });
}

function screenPerson<T extends { name: string; phone: string }>(
  people: readonly T[], label: (p: T) => string, section: 'contacts' | 'careTeam', undiagnosed: boolean,
): Built<T> {
  return people.reduce<Built<T>>((acc, person, i) => {
    const describe = label(person);
    const reason = screenText(`${person.name}. ${describe}`, { checkDiagnosis: undiagnosed, checkInstruction: false })
      ?? (readsAsInstruction(describe) ? 'instruction' : null);
    return reason
      ? { ...acc, dropped: [...acc.dropped, { id: `${section}-${i + 1}`, section, text: `${person.name} (${describe})`, reason }] }
      : { ...acc, kept: [...acc.kept, { ...person }] };
  }, { kept: [], dropped: [] });
}

export interface BuildCardInput {
  caseId: string;
  undiagnosed: boolean;
  needs: NeedsForCard | null;
  events: readonly HistoryEvent[];
  documents: readonly Pick<HistoryDocument, 'id' | 'title'>[];
  inputs: CardInputs;
}

/** Builds the card content plus the list of dropped lines (judge view). Pure; never mutates its inputs. */
export function buildCard(input: BuildCardInput): { content: CardContent; dropped: DroppedLine[] } {
  const facts = buildFacts(input.needs, input.undiagnosed);
  const records = buildRecords(input.events, input.documents, input.undiagnosed);
  const contacts = screenPerson(input.inputs.contacts, (c) => c.relationship, 'contacts', input.undiagnosed);
  const careTeam = screenPerson(input.inputs.careTeam, (c) => c.role, 'careTeam', input.undiagnosed);
  return {
    content: { header: EMERGENCY_HEADER, facts: facts.kept, records: records.kept, contacts: contacts.kept, careTeam: careTeam.kept },
    dropped: [...facts.dropped, ...records.dropped, ...contacts.dropped, ...careTeam.dropped],
  };
}

export function isEmptyCard(content: CardContent): boolean {
  return content.facts.length + content.records.length + content.contacts.length + content.careTeam.length === 0;
}
