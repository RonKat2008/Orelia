import type { HistoryDocument, HistoryEvent, HistoryTimeline } from './contract';
import { detectConflicts } from './conflicts';
import { dateSortKey } from './dates';

/** Date ascending (partial dates first within their period), undated last, then document and position. */
export function sortEvents(events: readonly HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => {
    const ka = dateSortKey(a.date); const kb = dateSortKey(b.date);
    if (ka === undefined && kb !== undefined) return 1;
    if (kb === undefined && ka !== undefined) return -1;
    if (ka !== kb && ka !== undefined && kb !== undefined) return ka < kb ? -1 : 1;
    return a.sourceDocId.localeCompare(b.sourceDocId) || a.span.start - b.span.start || a.id.localeCompare(b.id);
  });
}

/** Strips document text (the share/UI payload never needs it), sorts events and attaches conflicts. */
export function buildTimeline(docs: HistoryDocument[], events: HistoryEvent[]): HistoryTimeline {
  return {
    documents: docs.map(d => { const { text, ...rest } = d; void text; return rest; }),
    events: sortEvents(events),
    conflicts: detectConflicts(docs, events),
  };
}
