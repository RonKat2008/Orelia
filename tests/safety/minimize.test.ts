import { describe, expect, it } from 'vitest';
import { containsUnsharedField } from '../../lib/safety/minimize';

describe('shared values containing unshared values', () => {
  const record = { planId: 'MSS-2290-8815-OH', homeState: 'OH' };

  it('permits every occurrence of a shared plan ID, including normalized text', () => {
    expect(containsUnsharedField('Plan MSS-2290-8815-OH; mss-2290-8815-oh.', record, ['planId'])).toBe(false);
  });

  it('still detects a standalone state beside the shared plan ID', () => {
    expect(containsUnsharedField('Plan MSS-2290-8815-OH; lives in OH.', record, ['planId'])).toBe(true);
  });

  it('refuses the plan ID when it is unshared', () => {
    expect(containsUnsharedField('Plan MSS-2290-8815-OH.', record, [])).toBe(true);
  });

  it('does not exempt a leak that extends beyond a shared value', () => {
    expect(containsUnsharedField('MSS-2290-8815-OH private', { ...record, note: 'OH private' }, ['planId', 'homeState'])).toBe(true);
  });
});

describe('two-letter home-state codes vs English words', () => {
  const record = (homeState: string) => ({ homeState, diseaseName: 'synthetic sarcoma' });

  it.each([
    ['IN', 'Please let me know in a few days; we are in touch and it is ok.'],
    ['OR', 'Mail or call. Is this OK or not? Tell me.'],
    ['ME', 'Please call me back. It is up to me.'],
    ['OK', 'Is that ok with you? OK, thanks.'],
    ['HI', 'Hi there, thanks for the help.'],
    ['OH', 'Oh, I see. oh well.'],
  ])('does not treat the English word as home state %s', (code, text) => {
    expect(containsUnsharedField(text, record(code), [])).toBe(false);
  });

  it.each([
    ['IN', 'Patient lives in Indianapolis, IN 46202.'],
    ['IN', 'Based in IN and willing to travel.'],
    ['IN', 'She is from Indiana.'],
    ['OR', 'Located in Portland, OR.'],
    ['OR', 'Portland OR 97201'],
    ['ME', 'Travelling from ME for the visit.'],
    ['OK', 'Tulsa, OK 74103'],
    ['OK', 'State: OK'],
  ])('still refuses a real %s state leak: %s', (code, text) => {
    expect(containsUnsharedField(text, record(code), [])).toBe(true);
  });

  it('does not refuse when the state is explicitly shared', () => {
    expect(containsUnsharedField('Patient lives in Indianapolis, IN 46202.', record('IN'), ['homeState'])).toBe(false);
  });

  it('exempts a state inside another shared value but not outside it', () => {
    const rec = { homeState: 'IN', location: 'Indianapolis, IN 46202' };
    expect(containsUnsharedField('Near Indianapolis, IN 46202.', rec, ['location'])).toBe(false);
    expect(containsUnsharedField('Near Indianapolis, IN 46202. Also lives in IN.', rec, ['location'])).toBe(true);
  });
});
