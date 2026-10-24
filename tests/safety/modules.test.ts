import { describe, it, expect } from 'vitest';
import { parseAllowlist, isAllowed } from '../../lib/safety/allowlist';
import { minimize, containsUnsharedField } from '../../lib/safety/minimize';
import { AI_DISCLOSURE_EMAIL, AI_DISCLOSURE_VOICE, withDisclosure, hasDisclosure } from '../../lib/safety/disclosure';
import { activeContactCount, canFollowUp, MAX_ACTIVE_CONTACTS, FOLLOW_UP_BUSINESS_DAYS } from '../../lib/safety/caps';
import { addBusinessDays } from '../../lib/workflows/business-days';
import { scaleDeadline } from '../../lib/workflows/clock';
import { flagMedicalAdvice, EMERGENCY_MESSAGE } from '../../lib/safety/no-medical-advice';

describe('allowlist', () => {
  it('defaults closed and ignores invalid entries', () => {
    expect(isAllowed('test@example.com', parseAllowlist(''))).toBe(false);
    expect(parseAllowlist('invalid,123,*, person@example.com.evil ')).toEqual(['person@example.com.evil']);
  });
  it('normalizes email case and formatted international phone numbers', () => {
    const list = parseAllowlist(' TEST@example.com, +1 (202) 555-0123 ');
    expect(isAllowed('test@EXAMPLE.COM', list)).toBe(true);
    expect(isAllowed('+12025550123', list)).toBe(true);
    expect(isAllowed('2025550123', list)).toBe(false);
    expect(isAllowed('test@example.com.evil', list)).toBe(false);
  });
});
describe('minimum necessary', () => {
  const record = { diseaseName: 'rare disease', insurer: 'Fictional Health', planId: 'ABC-123', stageSummary: 'localized stage', goals: ['support', 'aid'], detail: { secret: 'hidden value' } };
  it('copies only own explicitly selected fields', () => {
    expect(minimize(record, ['diseaseName', 'missing', 'toString'])).toEqual({ diseaseName: 'rare disease' });
    expect(minimize(record, [])).toEqual({});
  });
  it.each(['fictional HEALTH', 'abc-123', 'localized   stage', 'hidden value', 'support'])('finds unshared value %s', body => {
    expect(containsUnsharedField(body, record, ['diseaseName'])).toBe(true);
  });
  it('permits shared fields and does not flag substrings inside other words', () => {
    expect(containsUnsharedField('rare disease coordination', record, ['diseaseName'])).toBe(false);
    expect(containsUnsharedField('chair', { goal: 'aid' }, [])).toBe(false);
  });
});
describe('disclosure', () => {
  it('appends the email disclosure once', () => {
    const body = withDisclosure('Please coordinate intake.');
    expect(body).toContain(AI_DISCLOSURE_EMAIL);
    expect(withDisclosure(body)).toBe(body);
    expect(hasDisclosure(body)).toBe(true);
    expect(hasDisclosure('AI helped')).toBe(false);
    expect(hasDisclosure(AI_DISCLOSURE_VOICE)).toBe(true);
  });
});
describe('caps and UTC business-day cadence', () => {
  it('counts only active states, unknown states conservatively active', () => {
    expect(MAX_ACTIVE_CONTACTS).toBe(5);
    expect(FOLLOW_UP_BUSINESS_DAYS).toEqual([3, 7]);
    expect(activeContactCount(['drafted','sent','replied','task_open','records_sent','declined','stalled','appointment_booked','connected'].map(state => ({ state })))).toBe(5);
  });
  const friday = '2026-10-23T15:00:00Z';
  it('skips weekends and waits until the full deadline', () => {
    expect(canFollowUp(friday, 0, '2026-10-28T14:59:59Z')).toBe(false);
    expect(canFollowUp(friday, 0, '2026-10-28T15:00:00Z')).toBe(true);
    const second = addBusinessDays(new Date(friday), 7);
    expect(canFollowUp(friday, 1, new Date(second.getTime() - 1))).toBe(false);
    expect(canFollowUp(friday, 1, second)).toBe(true);
  });
  it('compresses the same business-day deadline under WAYFINDER_SIM_TIME_SCALE, except in production', () => {
    const anchor = new Date('2026-03-02T15:00:00.000Z');
    const real = addBusinessDays(anchor, 3);
    const minuteish = scaleDeadline(anchor, real, 1440);
    const env = process.env as Record<string, string | undefined>;
    const prevScale = process.env.WAYFINDER_SIM_TIME_SCALE;
    const prevNode = env.NODE_ENV;
    process.env.WAYFINDER_SIM_TIME_SCALE = '1440';
    env.NODE_ENV = 'test';
    try {
      expect(canFollowUp(anchor, 0, new Date(minuteish.getTime() - 1))).toBe(false);
      expect(canFollowUp(anchor, 0, minuteish)).toBe(true);
      env.NODE_ENV = 'production';
      expect(canFollowUp(anchor, 0, minuteish)).toBe(false);
      expect(canFollowUp(anchor, 0, real)).toBe(true);
    } finally {
      if (prevScale === undefined) delete process.env.WAYFINDER_SIM_TIME_SCALE;
      else process.env.WAYFINDER_SIM_TIME_SCALE = prevScale;
      if (prevNode === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = prevNode;
    }
  });
  it('rejects exhausted, invalid, fractional and future schedules', () => {
    for (const count of [-1, 0.5, 2, NaN]) expect(canFollowUp(friday, count, '2027-01-01')).toBe(false);
    expect(canFollowUp('invalid', 0, friday)).toBe(false);
    expect(canFollowUp('2027-01-01', 0, friday)).toBe(false);
  });
});
describe('medical advice filter', () => {
  it.each(['You should take chemotherapy.', 'I recommend surgery.', 'Your prognosis is excellent.', 'Take 20 mg daily.', 'The best treatment is radiation.', 'Therapy A is better than therapy B.', 'You should take aspirin.', 'Increase your dose.', 'Chemotherapy is the best option.', 'Take aspirin daily.'])('flags %s', text => {
    expect(flagMedicalAdvice(text).flagged).toBe(true);
    expect(flagMedicalAdvice(text).matches.length).toBeGreaterThan(0);
  });
  it('permits care coordination and the emergency message', () => {
    expect(flagMedicalAdvice('Please arrange a second opinion and send records.').flagged).toBe(false);
    expect(EMERGENCY_MESSAGE).toBe('If you have new or worsening symptoms, contact your care team or call 911.');
    expect(flagMedicalAdvice(EMERGENCY_MESSAGE).flagged).toBe(false);
  });
});
