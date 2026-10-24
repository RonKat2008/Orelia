import { describe, expect, it } from 'vitest';
import { shortEvidenceId } from '@/components/plan/model';

describe('shortEvidenceId', () => {
  it('labels demo coordinator evidence instead of showing an id fragment', () => {
    expect(shortEvidenceId('contact_point:demo_coordinator:0c82fed8-0bb8-499e-8a58-fcce5c3bcee0')).toBe('Demo coordinator (test inbox)');
  });

  it('keeps the short id label for ordinary evidence', () => {
    expect(shortEvidenceId('ev-1234-abcdef')).toBe('Source abcdef');
  });
});

describe('demo coordinator prefix', () => {
  it('matches the server constant', async () => {
    const { DEMO_COORDINATOR_EVIDENCE_PREFIX } = await import('@/lib/plan/contact-points');
    expect(shortEvidenceId(`${DEMO_COORDINATOR_EVIDENCE_PREFIX}x`)).toBe('Demo coordinator (test inbox)');
  });
});
