import {
  CONFLICT_NOTE, conflictSchema, type Conflict, type HistoryDocument, type HistoryEvent,
} from './contract';
import {
  MARKERS, VARIANT_CLASS_LABELS, classifyVariantTerm, normalizeDiagnosis, type VariantClass,
} from './clinical-terms';
import { dateSortKey } from './dates';

/** One thing a single record says about a topic. */
interface Observation {
  event: HistoryEvent;
  topicKey: string;
  topicLabel: string;
  valueKey: string;
  text: string;
}

type DocRef = Pick<HistoryDocument, 'id' | 'title'>;

const clip = (s: string, n = 400): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Later date wins; undated is oldest; on equal dates the narrower (more specific) span, then the lower id. */
function isLater(a: HistoryEvent, b: HistoryEvent): boolean {
  const ka = dateSortKey(a.date) ?? ''; const kb = dateSortKey(b.date) ?? '';
  if (ka !== kb) return ka > kb;
  const wa = a.span.end - a.span.start; const wb = b.span.end - b.span.start;
  return wa !== wb ? wa < wb : a.id.localeCompare(b.id) < 0;
}
function isEarlier(a: HistoryEvent, b: HistoryEvent): boolean {
  const ka = dateSortKey(a.date); const kb = dateSortKey(b.date);
  if (ka === undefined) return false;
  if (kb === undefined) return true;
  if (ka !== kb) return ka < kb;
  const wa = a.span.end - a.span.start; const wb = b.span.end - b.span.start;
  return wa !== wb ? wa < wb : a.id.localeCompare(b.id) < 0;
}

/**
 * Groups observations by topic, keeps the latest observation per document, and reports a conflict when two or
 * more documents give different values. Never says which value is right.
 */
function conflictsFrom(kind: Conflict['kind'], observations: Observation[], titles: Map<string, string>): Conflict[] {
  const byTopic = new Map<string, Observation[]>();
  for (const o of observations) byTopic.set(o.topicKey, [...(byTopic.get(o.topicKey) ?? []), o]);
  const out: Conflict[] = [];
  for (const [topicKey, all] of byTopic) {
    const perDoc = new Map<string, Observation>();
    for (const o of all) {
      const current = perDoc.get(o.event.sourceDocId);
      if (!current || isLater(o.event, current.event)) perDoc.set(o.event.sourceDocId, o);
    }
    const byValue = new Map<string, Observation[]>();
    for (const o of perDoc.values()) byValue.set(o.valueKey, [...(byValue.get(o.valueKey) ?? []), o]);
    if (byValue.size < 2) continue;
    const reps = [...byValue.values()].map(group => group.reduce((a, b) => (isEarlier(b.event, a.event) ? b : a)));
    reps.sort((a, b) => (isEarlier(a.event, b.event) ? -1 : isEarlier(b.event, a.event) ? 1 : a.event.id.localeCompare(b.event.id)));
    const candidate = {
      id: `${kind}-${fnv(`${kind}|${topicKey}`)}`,
      kind,
      topic: clip(all[0]!.topicLabel, 200),
      statements: reps.map(r => ({
        eventId: r.event.id, sourceDocId: r.event.sourceDocId, docTitle: titles.get(r.event.sourceDocId) ?? r.event.sourceDocId,
        date: r.event.date, text: clip(r.text),
      })),
      note: CONFLICT_NOTE,
    };
    const parsed = conflictSchema.safeParse(candidate);
    if (parsed.success && new Set(parsed.data.statements.map(s => s.sourceDocId)).size >= 2) out.push(parsed.data);
  }
  return out;
}

// ---- diagnoses -----------------------------------------------------------------------------------------------
function diagnosisObservations(events: HistoryEvent[]): Observation[] {
  return events.filter(e => e.kind === 'diagnosis').map(event => {
    const n = normalizeDiagnosis(event.title);
    return { event, topicKey: 'primary-diagnosis', topicLabel: 'Primary diagnosis named in the records', valueKey: n.key, text: event.findings[0] ?? event.title };
  });
}

// ---- variant classification ----------------------------------------------------------------------------------
const VARIANT_TOKEN = /c\.[^\s,;()|]+/;
const GENE_TITLE = /^([A-Z][A-Z0-9-]{1,9})\s/;

function parseVariant(event: HistoryEvent): { gene: string; variant: string; cls: VariantClass; line: string } | null {
  const lines = event.findings;
  const joined = `${event.title}\n${lines.join('\n')}`;
  const variant = VARIANT_TOKEN.exec(joined)?.[0];
  if (!variant) return null;
  const gene = GENE_TITLE.exec(event.title)?.[1]
    ?? /\bgene\s*[:\-]\s*\**([A-Z][A-Z0-9-]{1,9})/i.exec(joined)?.[1]?.toUpperCase()
    ?? lines.map(l => /\b([A-Z][A-Z0-9]{2,9})\b[^\n]{0,40}?c\./.exec(l)?.[1]).find(Boolean);
  if (!gene) return null;
  const labelled = lines.find(l => /^\W*(?:acmg )?(?:classification|interpretation|pathogenicity)\b/i.test(l) && classifyVariantTerm(l));
  const line = labelled ?? lines.find(l => classifyVariantTerm(l));
  const cls = line ? classifyVariantTerm(line) : null;
  return cls && line ? { gene, variant: variant.replace(/[.,]+$/, ''), cls, line } : null;
}

function variantObservations(events: HistoryEvent[]): Observation[] {
  const out: Observation[] = [];
  for (const event of events) {
    if (event.kind !== 'genetic_test') continue;
    const v = parseVariant(event);
    if (!v) continue;
    out.push({
      event, topicKey: `${v.gene}|${v.variant.toLowerCase()}`, topicLabel: `${v.gene} ${v.variant} classification`,
      valueKey: v.cls, text: `${v.gene} ${v.variant}: ${v.line}`,
    });
  }
  return out;
}

// ---- medications ---------------------------------------------------------------------------------------------
const DOSE_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|units?|iu|ml)\b/i;

function medicationObservations(events: HistoryEvent[]): Observation[] {
  const out: Observation[] = [];
  for (const event of events) {
    if (event.kind !== 'medication') continue;
    const dose = DOSE_RE.exec(event.title);
    if (!dose) continue;
    const name = event.title.slice(0, dose.index).replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.length < 3) continue;
    const unit = dose[2]!.toLowerCase();
    out.push({
      event, topicKey: name.toLowerCase(), topicLabel: `${name.charAt(0).toUpperCase()}${name.slice(1).toLowerCase()} dose`,
      valueKey: `${Number(dose[1])}${unit}`, text: event.findings[0] ?? event.title,
    });
  }
  return out;
}

// ---- lab / IHC markers ---------------------------------------------------------------------------------------
function markerObservations(events: HistoryEvent[]): Observation[] {
  const out: Observation[] = [];
  for (const event of events) {
    if (event.kind === 'medication') continue;
    for (const line of event.findings) {
      for (const marker of MARKERS) {
        const hit = marker.pattern.exec(line);
        if (!hit) continue;
        const after = line.slice(hit.index + hit[0].length, hit.index + hit[0].length + 90);
        const before = line.slice(Math.max(0, hit.index - 30), hit.index);
        let best: { status: string; at: number } | undefined;
        for (const [status, re] of marker.statuses) {
          const m = re.exec(after);
          if (m && (!best || m.index < best.at)) best = { status, at: m.index };
        }
        if (!best) {
          for (const [status, re] of marker.statuses) if (re.test(before)) { best = { status, at: -1 }; break; }
        }
        if (best) {
          out.push({ event, topicKey: marker.key, topicLabel: `${marker.label} status`, valueKey: best.status, text: line });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Finds places where different documents say different things: primary diagnosis, variant classification,
 * medication dose and lab/IHC marker status. Output only quotes the records; it never picks a winner.
 */
export function detectConflicts(docs: DocRef[], events: HistoryEvent[]): Conflict[] {
  const titles = new Map(docs.map(d => [d.id, d.title]));
  const all = [
    ...conflictsFrom('diagnosis', diagnosisObservations(events), titles),
    ...conflictsFrom('variant_classification', variantObservations(events), titles),
    ...conflictsFrom('medication', medicationObservations(events), titles),
    ...conflictsFrom('other', markerObservations(events), titles),
  ];
  return all.sort((a, b) => a.kind.localeCompare(b.kind) || a.topic.localeCompare(b.topic));
}

export { VARIANT_CLASS_LABELS };
