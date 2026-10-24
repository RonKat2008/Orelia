import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConflictsPanel } from '@/components/history/ConflictsPanel';
import { HistoryTimelineView } from '@/components/history/HistoryTimeline';
import { addRecord, getTimeline, loadSample } from '@/components/history/client';
import { resolveJourney } from '@/components/journey/model';
import { MotionPreference } from '@/lib/motion/MotionPreference';
import { CONFLICT_NOTE, type Conflict, type HistoryEvent } from '@/lib/history/contract';

const event = (id: string, date: string | null): HistoryEvent => ({
  id, date, kind: 'diagnosis', title: `Title ${id}`, provider: 'Dr. Rivera', institution: 'Synthetic Clinic',
  findings: ['finding one'], sourceDocId: 'd1', span: { start: 0, end: 4 },
});
const conflict: Conflict = {
  id: 'c1', kind: 'diagnosis', topic: 'Diagnosis wording', note: CONFLICT_NOTE,
  statements: [
    { eventId: 'a', sourceDocId: 'd1', docTitle: 'Clinic letter', date: '2020-01', text: 'says X' },
    { eventId: 'b', sourceDocId: 'd2', docTitle: 'Hospital summary', date: '2021', text: 'says Y' },
  ],
};

describe('ConflictsPanel', () => {
  it('shows both quotes with sources and the neutral note', () => {
    const html = renderToStaticMarkup(createElement(ConflictsPanel, { conflicts: [conflict] }));
    expect(html).toContain('Conflicts to discuss with your doctor');
    expect(html).toContain('says X');
    expect(html).toContain('Source: Hospital summary');
    expect(html).toContain(CONFLICT_NOTE);
    expect(html).not.toMatch(/correct|incorrect|likely right/i);
  });
  it('renders nothing without conflicts', () => {
    expect(renderToStaticMarkup(createElement(ConflictsPanel, { conflicts: [] }))).toBe('');
  });
});

describe('HistoryTimelineView', () => {
  const events = [event('a', '2020-01'), event('b', null)];
  const render = () => renderToStaticMarkup(
    createElement(MotionPreference, { reducedMotion: true },
      createElement(HistoryTimelineView, {
        events, conflicts: [conflict], documentTitles: new Map([['d1', 'Clinic letter']]), highlightId: 'a',
      })),
  );
  it('groups by year, cites the source and badges conflicts', () => {
    const html = render();
    expect(html).toContain('id="history-year-2020"');
    expect(html).toContain('id="history-year-Undated"');
    expect(html).toContain('Source: Clinic letter');
    expect(html).toContain('Conflict to discuss');
    expect(html).toContain('data-highlighted');
  });
  it('shows events immediately with reduced motion (no hidden initial style)', () => {
    expect(render()).not.toContain('opacity:0');
  });
  it('explains an empty filter result', () => {
    const html = renderToStaticMarkup(createElement(HistoryTimelineView, { events: [], conflicts: [], documentTitles: new Map(), highlightId: null }));
    expect(html).toContain('No events match');
  });
});

describe('client', () => {
  const timeline = { documents: [], events: [], conflicts: [] };
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('parses a timeline', async () => {
    const r = await getTimeline('c1', ok({ timeline }));
    expect(r).toEqual({ ok: true, data: timeline });
  });
  it('rejects an unexpected shape', async () => {
    const r = await getTimeline('c1', ok({ timeline: { events: 3 } }));
    expect(r.ok).toBe(false);
  });
  it('surfaces API errors and 404 status', async () => {
    const r = await loadSample('c1', 'vascular-eds', ok({ error: { message: 'nope' } }, 404));
    expect(r).toEqual({ ok: false, status: 404, message: 'nope' });
  });
  it('handles network failure', async () => {
    const r = await addRecord('c1', { title: 't', text: 'x' }, (async () => { throw new Error('down'); }) as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});

describe('journey nav', () => {
  it('exposes a history href', () => {
    const plan = resolveJourney('abc', { status: 'confirmed', selectedCount: 0, openTaskCount: 0, contacts: [] });
    expect(plan.historyHref).toBe('/cases/abc/history');
  });
});
