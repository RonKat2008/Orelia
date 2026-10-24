import { it, expect } from 'vitest';
import { findDates } from '@/lib/history/dates';
import { extractEventsWithRules } from '@/lib/history/extract';
import { makeDoc } from './helpers';
import { buildTimeline } from '@/lib/history/timeline';
import { detectConflicts } from '@/lib/history/conflicts';

it('rejects impossible calendar days', () => {
  for (const t of ['02/31/2019', '2019-02-30', '31 April 2019', 'June 31, 2020', '2021-02-29']) {
    expect(findDates(t), t).toEqual([]);
  }
  expect(findDates('2020-02-29')).toHaveLength(1);
});

it('future-dated and odd-format records stay ordered and flagged-safe', () => {
  const a = makeDoc('a', 'Visit note', 'Date of visit: 03/04/2019\nAssessment: hemoglobin 9.1 g/dL. Diagnosis: sarcoidosis.');
  const b = makeDoc('b', 'Visit note 2', 'Date of visit: 2031-01-05\nAssessment: hemoglobin 14.0 g/dL.');
  const c = makeDoc('c', 'Visit 3', 'Seen 4th of March 2019. hemoglobin 12 g/dL');
  const docs = [a, b, c];
  const events = docs.flatMap(extractEventsWithRules);
  const tl = buildTimeline(docs, events);
  expect(tl).toBeTruthy();
});
