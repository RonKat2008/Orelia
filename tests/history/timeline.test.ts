import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@/lib/history/contract';
import { buildTimeline } from '@/lib/history/timeline';
import { fixtureEvents, makeDoc } from './helpers';

const ev = (id: string, date: string | null): HistoryEvent => ({
  id, date, kind: 'note', title: id, provider: null, institution: null, findings: [], sourceDocId: 'd', span: { start: 0, end: 1 },
});

describe('buildTimeline', () => {
  it('sorts ascending with partial dates first and undated last', () => {
    const doc = makeDoc('d', 'Doc', 'x');
    const t = buildTimeline([doc], [ev('c', null), ev('b', '2020-05-01'), ev('a', '2020'), ev('d2', '2019-12-31'), ev('e', '2020-05')]);
    expect(t.events.map(e => e.id)).toEqual(['d2', 'a', 'e', 'b', 'c']);
  });
  it('strips document text and attaches conflicts', async () => {
    const { docs, events } = await fixtureEvents('vascular-eds');
    const t = buildTimeline(docs, events);
    expect(t.documents).toHaveLength(docs.length);
    expect(t.documents.every(d => !('text' in d))).toBe(true);
    expect(t.conflicts.length).toBeGreaterThanOrEqual(2);
    const dated = t.events.filter(e => e.date);
    expect(dated.map(e => e.date)).toEqual([...dated.map(e => e.date)].sort((x, y) => x!.padEnd(10, '0').localeCompare(y!.padEnd(10, '0'))));
  });
});
