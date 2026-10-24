import { describe, expect, it } from 'vitest';
import { stepLabel } from '@/components/plan/model';

describe('stepLabel', () => {
  it('names the purpose and channel once', () => {
    expect(stepLabel({ purpose: 'intro', channel: 'email' })).toBe('Introduce by email');
    expect(stepLabel({ purpose: 'apply', channel: 'web_form' })).toBe('Apply by online form');
    expect(stepLabel({ purpose: 'intro', channel: 'voice' })).toBe('Introduce by phone call');
  });
  it('does not say "by phone" twice for a verification call', () => {
    expect(stepLabel({ purpose: 'verify', channel: 'voice' })).toBe('Verify by phone call');
  });
});
