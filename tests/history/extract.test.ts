import { describe, expect, it } from 'vitest';
import { historyEventSchema } from '@/lib/history/contract';
import { findDates } from '@/lib/history/dates';
import { extractEventsWithRules, inferDocType } from '@/lib/history/extract';
import { HISTORY_FIXTURE_SLUGS } from '@/fixtures/history';
import { fixtureDocs, makeDoc } from './helpers';

describe('findDates', () => {
  it.each([
    ['seen 2019-03-04 in clinic', '2019-03-04'],
    ['seen 03/04/2019 in clinic', '2019-03-04'],
    ['seen 13/04/2019 in clinic', '2019-04-13'],
    ['seen March 4, 2019 in clinic', '2019-03-04'],
    ['seen 4 March 2019 in clinic', '2019-03-04'],
    ['seen Mar 2019 in clinic', '2019-03'],
  ])('%s', (text, iso) => expect(findDates(text)[0]?.iso).toBe(iso));

  it('only reads a bare year when asked', () => {
    expect(findDates('in 2019 we')).toEqual([]);
    expect(findDates('in 2019 we', { bareYear: true })[0]?.iso).toBe('2019');
  });
  it('rejects impossible dates', () => expect(findDates('99/99/2019 and 2019-13-45')).toEqual([]));
});

describe('inferDocType', () => {
  it('uses the title first', () => {
    expect(inferDocType('Genetic test report', 'x')).toBe('genetic_report');
    expect(inferDocType('Brain MRI', 'x')).toBe('imaging_report');
    expect(inferDocType('Hospital discharge summary', 'x')).toBe('discharge_summary');
    expect(inferDocType('Untitled', 'Dear Dr. Lee, ... Sincerely')).toBe('letter');
    expect(inferDocType('Untitled', 'nothing')).toBe('other');
  });
});

describe('extractEventsWithRules on messy text', () => {
  const text = [
    'Notes from several visits',
    '',
    '2018: Seen at Maple Hospital by Dr. Jane Roe. Started physical therapy.',
    '',
    'March 4, 2019 - MRI of the brain at Harbor Imaging Clinic. Impression: no acute abnormality.',
    '',
    '03/09/2020 Genetic panel sent. Jane Smith, MD reviewed the result.',
  ].join('\n');

  it('finds each dated entry with provider/institution and grounded findings', () => {
    const events = extractEventsWithRules(makeDoc('d1', 'Notes', text));
    expect(events.map(e => e.date)).toEqual(['2018', '2019-03-04', '2020-03-09']);
    expect(events[1]!.kind).toBe('imaging');
    expect(events[1]!.institution).toBe('Harbor Imaging Clinic');
    expect(events[0]!.provider).toBe('Dr. Jane Roe');
    expect(events[2]!.provider).toBe('Jane Smith, MD');
    expect(events.map(e => e.id)).toEqual(['d1:0', 'd1:1', 'd1:2']);
  });

  it('keeps undated text as an undated event', () => {
    const events = extractEventsWithRules(makeDoc('d2', 'Letter', 'Dear Dr. Lee,\nThe patient was well.\nSincerely, A. Person'));
    expect(events).toHaveLength(1);
    expect(events[0]!.date).toBeNull();
  });

  it('is deterministic', () => {
    const doc = makeDoc('d1', 'Notes', text);
    expect(extractEventsWithRules(doc)).toEqual(extractEventsWithRules(doc));
  });
});

describe.each(HISTORY_FIXTURE_SLUGS)('rule extraction on fixture %s', slug => {
  it('yields valid, grounded events with dates and several kinds', async () => {
    const docs = await fixtureDocs(slug);
    expect(docs.length).toBeGreaterThanOrEqual(4);
    expect(docs.length).toBeLessThanOrEqual(6);
    const all = docs.flatMap(d => {
      const events = extractEventsWithRules(d);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(historyEventSchema.safeParse(e).success).toBe(true);
        expect(e.id.startsWith(`${d.id}:`)).toBe(true);
        expect(e.span.end).toBeLessThanOrEqual(d.text.length);
        const slice = d.text.slice(e.span.start, e.span.end);
        for (const f of e.findings) expect(slice).toContain(f);
      }
      return events;
    });
    expect(all.every(e => e.date !== null)).toBe(true);
    const years = new Set(all.map(e => e.date!.slice(0, 4)));
    expect(years.size).toBeGreaterThanOrEqual(2);
    const kinds = new Set(all.map(e => e.kind));
    expect(kinds.has('diagnosis')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});

describe('fixture specifics', () => {
  it('extracts the genetic variants and classification lines from vascular-eds', async () => {
    const docs = await fixtureDocs('vascular-eds');
    const genetic = docs.flatMap(extractEventsWithRules).filter(e => e.kind === 'genetic_test' && e.title === 'COL3A1 c.1834G>A');
    expect(genetic.length).toBeGreaterThanOrEqual(2);
    expect(genetic.some(e => e.findings.some(f => /Likely pathogenic/.test(f)))).toBe(true);
    expect(genetic.some(e => e.findings.some(f => /uncertain significance/i.test(f)))).toBe(true);
  });
  it('extracts medication items from igg4', async () => {
    const docs = await fixtureDocs('igg4-related-disease');
    const meds = docs.flatMap(extractEventsWithRules).filter(e => e.kind === 'medication').map(e => e.title);
    expect(meds).toContain('Omeprazole 40 mg daily');
    expect(meds).toContain('Prednisone 40 mg daily');
  });
});
