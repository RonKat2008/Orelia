import { describe, expect, it } from 'vitest';
import { rank } from '../../lib/ranking/rank';
import { RANKING_WEIGHTS } from '../../config/ranking';

describe('ranking input boundaries', () => {
  it.each([-1, NaN, Infinity, -Infinity])('refuses unsafe weight %s before scoring', access => {
    expect(() => rank([], { ...RANKING_WEIGHTS, access })).toThrow('finite and non-negative');
  });
  it.each([-0.01, 1.01, Infinity, -Infinity])('refuses out-of-range signal %s even without evidence', value => {
    expect(() => rank([{ id: 'synthetic', signals: { access: { value, text: '', evidenceIds: [] } } }])).toThrow('Invalid access signal');
  });
  it('refuses an empty candidate identifier', () => {
    expect(() => rank([{ id: '' }])).toThrow('unique nonempty');
  });
  it('does not score evidence with blank explanatory text', () => {
    const [result] = rank([{ id: 'synthetic', signals: { access: { value: 1, text: ' \n ', evidenceIds: ['ev1'] } } }]);
    expect(result.score).toBe(0);
    expect(result.breakdown.find(item => item.factor === 'access')).toEqual({ factor: 'access', points: 0, text: 'No verified evidence available', evidenceIds: [] });
  });
  it('preserves verified explanations when a factor has zero weight', () => {
    const [result] = rank([{ id: 'synthetic', signals: { access: { value: 1, text: 'Verified location', evidenceIds: ['ev2', 'ev1', 'ev2'] } } }], { ...RANKING_WEIGHTS, access: 0 });
    expect(result.score).toBe(0);
    expect(result.breakdown.find(item => item.factor === 'access')).toMatchObject({ points: 0, text: 'Verified location', evidenceIds: ['ev1', 'ev2'] });
  });
  it('sorts tied candidates by identifier in either input order', () => {
    for (const candidates of [[{ id: 'z' }, { id: 'a' }], [{ id: 'a' }, { id: 'z' }]]) {
      expect(rank(candidates).map(({ id, rank }) => ({ id, rank }))).toEqual([{ id: 'a', rank: 1 }, { id: 'z', rank: 2 }]);
    }
  });
});
