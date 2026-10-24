import { describe, expect, it } from 'vitest';
import { cleanSnippet, extractRequirements } from '@/lib/coordination/requirements/extract';

const page = (text: string) => ({ url: 'https://clinic.example.org/new-patients', text, origin: 'exa' as const });

describe('requirement snippet cleanup', () => {
  it('strips a leading list number like "126 - "', () => {
    const [r] = extractRequirements([page('126 - Patients must bring a referral letter from their physician.')]);
    expect(r!.detail).toBe('Patients must bring a referral letter from their physician.');
  });

  it.each([
    ['3. A referral is required.', 'A referral is required.'],
    ['(b) A referral is required.', 'A referral is required.'],
    ['iv) A referral is required.', 'A referral is required.'],
    ['[12] A referral is required.', 'A referral is required.'],
    ['* † A referral is required.', 'A referral is required.'],
    ['• 2) A referral is required.', 'A referral is required.'],
    ['A referral is required.[3]', 'A referral is required.'],
    ['A referral is required.¹²', 'A referral is required.'],
    ['A referral is required.*', 'A referral is required.'],
  ])('cleans %j', (raw, want) => {
    expect(cleanSnippet(raw)).toBe(want);
  });

  it('keeps numbers that are part of the sentence', () => {
    expect(cleanSnippet('24 hours notice is needed for a referral.')).toBe('24 hours notice is needed for a referral.');
    expect(cleanSnippet('Bring 2 copies of your records.')).toBe('Bring 2 copies of your records.');
  });
});
