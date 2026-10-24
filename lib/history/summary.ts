/**
 * Pure summary builder (no node-only imports: the printable page runs it in the browser).
 * Only the sections the patient ticked are included; nothing from other kinds can leak through,
 * and the source list only cites documents used by included events.
 */
import {
  EVENT_KIND_LABELS, EVENT_KINDS, SUMMARY_DISCLAIMER,
  type Conflict, type HistoryEvent, type HistorySummary, type HistoryTimeline, type ShareSection, type SummarySection,
} from './contract';

export const CONFLICTS_SECTION_LABEL = 'Conflicts to discuss with your doctor';
export const ALL_SHARE_SECTIONS: readonly ShareSection[] = [...EVENT_KINDS, 'conflicts'];

function sectionLabel(key: ShareSection): string {
  return key === 'conflicts' ? CONFLICTS_SECTION_LABEL : EVENT_KIND_LABELS[key];
}

export function buildSummary(timeline: HistoryTimeline, sections: readonly ShareSection[], now: Date): HistorySummary {
  const wanted = new Set(sections);
  const keys = ALL_SHARE_SECTIONS.filter(k => wanted.has(k));
  const usedDocIds = new Set<string>();
  const built: SummarySection[] = keys.map(key => {
    if (key === 'conflicts') {
      // A conflict quotes records; only quote events whose own section was ticked, and only keep conflicts that
      // still compare at least two different records after that filter.
      const kindOf = new Map(timeline.events.map(e => [e.id, e.kind] as const));
      const conflicts: Conflict[] = timeline.conflicts
        .map(c => ({ ...c, statements: c.statements.filter(s => { const k = kindOf.get(s.eventId); return k !== undefined && wanted.has(k); }).map(s => ({ ...s })) }))
        .filter(c => new Set(c.statements.map(s => s.sourceDocId)).size >= 2);
      for (const c of conflicts) for (const s of c.statements) usedDocIds.add(s.sourceDocId);
      return { key, label: sectionLabel(key), events: [], conflicts };
    }
    const events: HistoryEvent[] = timeline.events.filter(e => e.kind === key).map(e => ({ ...e, findings: [...e.findings] }));
    for (const e of events) usedDocIds.add(e.sourceDocId);
    return { key, label: sectionLabel(key), events };
  });
  const sources = timeline.documents
    .filter(d => usedDocIds.has(d.id))
    .map(d => ({ id: d.id, title: d.title, docType: d.docType }));
  return { generatedAt: now.toISOString(), sources, sections: built, disclaimer: SUMMARY_DISCLAIMER };
}
