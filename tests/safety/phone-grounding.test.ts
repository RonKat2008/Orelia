import { describe, expect, it } from 'vitest';
import { isPhoneGrounded, normalizePhone, phoneNumbersIn } from '../../lib/safety/phone-grounding';

describe('phone grounding', () => {
  it('normalizes formats', () => {
    expect(normalizePhone('+1 (202) 555-0189')).toBe('2025550189');
  });
  it('accepts a number in any format that appears as one token', () => {
    expect(isPhoneGrounded('202-555-0189', 'Her direct line is (202) 555-0189.')).toBe(true);
    expect(isPhoneGrounded('+1 202 555 0189', 'call 202.555.0189 today')).toBe(true);
    expect(isPhoneGrounded('2025550189', 'tel: +1-202-555-0189')).toBe(true);
  });
  it('rejects digits that only exist by joining unrelated numbers', () => {
    expect(isPhoneGrounded('(102) 420-2694', 'received 10/24/2026 at our 94110 office')).toBe(false);
    expect(isPhoneGrounded('555-012-3456', 'MRN 5550 at our 123456 location')).toBe(false);
  });
  it('checks every source and rejects empty input', () => {
    expect(isPhoneGrounded('202-555-0189', 'nothing here', 'ring 202-555-0189')).toBe(true);
    expect(isPhoneGrounded(undefined, 'x')).toBe(false);
    expect(isPhoneGrounded('12345', '12345')).toBe(false);
  });
  it('extracts tokens', () => {
    expect(phoneNumbersIn('A 202-555-0189 or 617 555 0100.')).toEqual(['2025550189', '6175550100']);
  });
});
