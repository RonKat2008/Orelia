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
