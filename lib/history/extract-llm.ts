import { z } from 'zod';
import type { chat } from '@/lib/ai/chat';
import { SYSTEM_UNTRUSTED_RULE, UNTRUSTED_CLOSE, UNTRUSTED_OPEN } from '@/lib/agents/research/untrusted';
import { eventKindSchema, historyEventSchema, partialDateSchema, type HistoryDocument, type HistoryEvent } from './contract';

export type ChatFn = typeof chat;

const llmEventSchema = z.object({
  date: z.string().nullable().optional(),
  kind: eventKindSchema,
  title: z.string().min(1),
  provider: z.string().nullable().optional(),
  institution: z.string().nullable().optional(),
  findings: z.array(z.string()).max(40).default([]),
  span: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
});
const llmOutputSchema = z.object({ events: z.array(llmEventSchema).max(80) });

const SYSTEM = [
  'You organise a patient\'s own medical record into a timeline. You never interpret, diagnose, advise or resolve disagreements.',
  'Return ONLY JSON: {"events":[{"date":"YYYY|YYYY-MM|YYYY-MM-DD|null","kind":"diagnosis|genetic_test|specialist_visit|imaging|lab|procedure|medication|hospitalization|note","title":"short","provider":"name or null","institution":"name or null","findings":["verbatim line copied from the record"],"span":{"start":0,"end":0}}]}.',
  'Every finding MUST be copied character for character from the record. Do not paraphrase. span is optional character offsets of the record section.',
  SYSTEM_UNTRUSTED_RULE,
].join('\n');

export function buildLlmMessages(doc: HistoryDocument): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${UNTRUSTED_OPEN}\nRecord title: ${doc.title}\n${doc.text}\n${UNTRUSTED_CLOSE}` },
  ];
}

function parseJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  const from = body.indexOf('{'); const to = body.lastIndexOf('}');
  return JSON.parse(from >= 0 && to > from ? body.slice(from, to + 1) : body);
}

function locate(text: string, finding: string, span?: { start: number; end: number }): { start: number; end: number } | null {
  const needle = finding.trim();
  if (!needle) return null;
  if (span && span.start >= 0 && span.end <= text.length && span.end > span.start) {
    const i = text.slice(span.start, span.end).indexOf(needle);
    if (i >= 0) return { start: span.start + i, end: span.start + i + needle.length };
  }
  const i = text.indexOf(needle);
  return i >= 0 ? { start: i, end: i + needle.length } : null;
}

/** Validates the model output and keeps only findings that appear verbatim in the record. Returns null if nothing usable. */
export function groundLlmOutput(doc: HistoryDocument, raw: string): HistoryEvent[] | null {
  const parsed = llmOutputSchema.safeParse(parseJson(raw));
  if (!parsed.success) return null;
  const events: HistoryEvent[] = [];
  for (const e of parsed.data.events) {
    const grounded = e.findings.map(f => ({ f: f.trim().slice(0, 400), at: locate(doc.text, f, e.span) })).filter(x => x.at);
    if (grounded.length === 0) continue;
    const declared = e.span && e.span.start >= 0 && e.span.end <= doc.text.length && e.span.end > e.span.start
      && grounded.every(g => g.at!.start >= e.span!.start && g.at!.end <= e.span!.end) ? e.span : null;
    const span = declared ?? {
      start: Math.min(...grounded.map(g => g.at!.start)), end: Math.max(...grounded.map(g => g.at!.end)),
    };
    // Headings and names are shown to the patient and drive conflict detection, so they must be grounded too.
    const groundedText = (value: string | null | undefined) => {
      const v = value?.trim().slice(0, 200);
      return v && locate(doc.text, v) ? v : null;
    };
    const title = groundedText(e.title) ?? grounded[0].f.slice(0, 200);
    const date = e.date && partialDateSchema.safeParse(e.date).success ? e.date : null;
    const candidate = historyEventSchema.safeParse({
      id: `${doc.id}:${events.length}`, date, kind: e.kind, title,
      provider: groundedText(e.provider), institution: groundedText(e.institution),
      findings: grounded.map(g => g.f).slice(0, 20), sourceDocId: doc.id, span,
    });
    if (candidate.success) events.push(candidate.data);
  }
  return events.length ? events : null;
}
