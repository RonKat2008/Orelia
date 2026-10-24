import { describe, expect, it } from 'vitest';
import { classifyIntakeDoors } from '@/lib/contact-finder';
import { contactPointsFromDoors, parseContactPoints, contactPointEvidence } from '@/lib/contact-finder/contact-points';

const url = 'https://www.hopkinsmedicine.org/vascular/new-patients';
const phonesOf = (text: string) => classifyIntakeDoors({ url, text }).flatMap((d) => d.phones ?? []);

describe('intake-door phone numbers', () => {
  it.each([
    ['New patient appointments: 410-955-5000', '+14109555000'],
    ['To schedule an appointment, call (410) 955-5000.', '+14109555000'],
    ['Appointments: 410.955.5000', '+14109555000'],
    ['Physician referrals: 1-800-555-0199 (toll free)', '+18005550199'],
    ['Request an appointment by phone at 410 955 5000', '+14109555000'],
  ])('reads a practice / intake line from %j', (text, want) => {
    expect(phonesOf(text)).toContain(want);
  });

  it('never reads fax, cell, mobile or pager numbers', () => {
    expect(phonesOf('New patient appointments fax: 410-955-0001')).toEqual([]);
    expect(phonesOf('Referrals: Fax 410-955-0001')).toEqual([]);
    expect(phonesOf('New patient appointments: call Dr. Lee on her cell 410-955-0002')).toEqual([]);
    expect(phonesOf('Appointments: mobile 410-955-0003')).toEqual([]);
  });

  it('keeps the phone line but drops the fax line in one block', () => {
    expect(phonesOf('New patient appointments: 410-955-5000 | Fax: 410-955-0001')).toEqual(['+14109555000']);
  });

  it('ignores phones that are not next to new-patient / appointment / referral text', () => {
    expect(phonesOf('Contact us\nMedia relations: 410-955-6666')).toEqual([]);
    expect(phonesOf('Our second-opinion program is in Baltimore. Billing questions 410-955-7777')).toEqual([]);
  });

  it('becomes a code-stamped voice contact point the plan parser accepts', () => {
    const doors = classifyIntakeDoors({ url, text: 'New patient appointments: 410-955-5000' });
    const points = contactPointsFromDoors(doors).filter((p) => p.channel === 'voice');
    expect(points).toEqual([expect.objectContaining({ channel: 'voice', address: '+14109555000', sourceUrl: url, sourceKind: 'exa' })]);
    const row = contactPointEvidence(points[0]!, '2026-01-01T00:00:00.000Z')!;
    expect(row.claimType).toBe('contact_point.voice.new_patient_line');
    expect(parseContactPoints([row])).toHaveLength(1);
  });
});
