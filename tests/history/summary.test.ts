import { describe, expect, it } from 'vitest';
import { SUMMARY_DISCLAIMER } from '@/lib/history/contract';
import { buildSummary } from '@/lib/history/summary';
import { timeline } from './share-fixtures';

const now = new Date('2026-10-24T10:00:00Z');

describe('buildSummary', () => {
  it('emits one section per requested kind in fixed order, ignoring request order', () => {
    const s = buildSummary(timeline, ['conflicts', 'specialist_visit', 'diagnosis'], now);
    expect(s.sections.map(x => x.key)).toEqual(['diagnosis', 'specialist_visit', 'conflicts']);
    expect(s.disclaimer).toBe(SUMMARY_DISCLAIMER);
    expect(s.generatedAt).toBe(now.toISOString());
  });
  it('keeps an empty section for a ticked kind with no events', () => {
    const s = buildSummary(timeline, ['imaging'], now);
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].events).toEqual([]);
  });
  it('leaks nothing from unticked sections, including sources and conflicts', () => {
    const s = buildSummary(timeline, ['diagnosis'], now);
    const text = JSON.stringify(s);
    for (const leak of ['Visit bravo', 'Finding bravo', 'Lab charlie', 'charlie-secret', 'Secret lab report', 'Cardiology visit', 'Topic delta', 'Statement two']) {
      expect(text).not.toContain(leak);
    }
    expect(s.sources.map(x => x.id)).toEqual(['d1']);
    expect(s.sections.some(x => x.key === 'conflicts')).toBe(false);
  });
  it('cites conflict source documents when conflicts and the quoted kinds are ticked', () => {
    const s = buildSummary(timeline, ['conflicts', 'diagnosis', 'specialist_visit'], now);
    expect(s.sources.map(x => x.id)).toEqual(['d1', 'd2']);
    expect(s.sections.find(x => x.key === 'conflicts')?.conflicts?.[0].topic).toBe('Topic delta');
  });
  it('conflicts never quote records from unticked kinds', () => {
    const only = buildSummary(timeline, ['conflicts'], now);
    expect(only.sections[0].conflicts).toEqual([]);
    expect(only.sources).toEqual([]);
    const text = JSON.stringify(only);
    for (const leak of ['Statement one', 'Statement two', 'Genetics letter', 'Cardiology visit']) expect(text).not.toContain(leak);
    // One quoted kind ticked leaves a single-record "conflict", which is dropped.
    expect(buildSummary(timeline, ['conflicts', 'diagnosis'], now).sections.find(x => x.key === 'conflicts')?.conflicts).toEqual([]);
  });
  it('does not mutate the timeline', () => {
    const before = JSON.stringify(timeline);
    buildSummary(timeline, ['diagnosis', 'conflicts'], now);
    expect(JSON.stringify(timeline)).toBe(before);
  });
});
