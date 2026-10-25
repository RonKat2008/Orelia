import { describe, expect, it } from 'vitest';
import { dedupeShortlist, normalizeHost, normalizeOrgName } from '../../lib/ranking/dedupe-shortlist';

const item = (name: string, rank: number, score = 10, targetKind = 'organization') => ({ targetKind, name, rank, score });

describe('normalizeOrgName', () => {
  it('strips parenthetical acronyms, punctuation, leading "the" and extra whitespace', () => {
    expect(normalizeOrgName('Castleman Disease Collaborative Network (CDCN)')).toBe('castleman disease collaborative network');
    expect(normalizeOrgName('The  Sarcoma Alliance, Inc.')).toBe('sarcoma alliance inc');
  });
});

describe('normalizeHost', () => {
  it('strips www and ignores invalid, missing and shared-platform URLs', () => {
    expect(normalizeHost('https://www.cdcn.org/about')).toBe('cdcn.org');
    expect(normalizeHost('not a url')).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost('https://clinicaltrials.gov/study/NCT1')).toBeNull();
  });
});

describe('dedupeShortlist', () => {
  it('keeps the better-ranked of two same-name entries', () => {
    const out = dedupeShortlist([item('Castleman Disease Collaborative Network (CDCN)', 3), item('Castleman Disease Collaborative Network', 1), item('Other', 2)]);
    expect(out.map(i => i.rank)).toEqual([1, 2]);
  });
  it('breaks a rank tie by score', () => {
    const out = dedupeShortlist([item('A Group', 1, 5), item('The A Group', 1, 9)]);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(9);
  });
  it('dedupes by URL host (www stripped) when both have one', () => {
    const urls: Record<string, string> = { 'Sarcoma Alliance': 'https://www.sarcomaalliance.org/a', 'Sarcoma Alliance for Research': 'https://sarcomaalliance.org/b' };
    const out = dedupeShortlist([item('Sarcoma Alliance', 1), item('Sarcoma Alliance for Research', 2)], i => urls[i.name]);
    expect(out).toHaveLength(1);
    expect(out[0].rank).toBe(1);
  });
  it('does not merge different kinds, different hosts, or shared hosts', () => {
    const shared = (): string => 'https://clinicaltrials.gov/x';
    expect(dedupeShortlist([item('X', 1, 1, 'expert'), item('X', 2, 1, 'institution')])).toHaveLength(2);
    expect(dedupeShortlist([item('A', 1), item('B', 2)], i => `https://${i.name}.org`)).toHaveLength(2);
    expect(dedupeShortlist([item('A', 1), item('B', 2)], shared)).toHaveLength(2);
  });
  it('preserves the original order of survivors', () => {
    const out = dedupeShortlist([item('B', 2), item('A (x)', 3), item('A', 1)]);
    expect(out.map(i => i.name)).toEqual(['B', 'A']);
  });
});

describe('dedupeShortlist kind rules', () => {
  it('never merges two experts who share a name, and keeps the contactable entry of a duplicate pair', () => {
    const experts = [
      { targetKind: 'expert', name: 'Dr. Jane Smith', rank: 1, score: 90 },
      { targetKind: 'expert', name: 'Dr Jane Smith', rank: 2, score: 80 },
    ];
    expect(dedupeShortlist(experts)).toHaveLength(2);
    const orgs = [
      { targetKind: 'organization', name: 'Castleman Disease Collaborative Network', rank: 1, score: 90, ok: false },
      { targetKind: 'organization', name: 'Castleman Disease Collaborative Network (CDCN)', rank: 2, score: 80, ok: true },
    ];
    expect(dedupeShortlist(orgs, () => null, (o) => o.ok).map((o) => o.rank)).toEqual([2]);
  });
});
