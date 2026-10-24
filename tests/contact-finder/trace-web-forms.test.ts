import { describe, expect, it } from 'vitest';
import { institutionContacts } from '@/lib/experts/trace';

const AT = '2026-01-01T00:00:00.000Z';

describe('expert trace institution contacts', () => {
  it('includes an online intake form on the institution site but not on a directory site', () => {
    // Arrange
    const form = { url: 'https://www.dana-farber.org/appointments/request-an-appointment', title: 'Request an Appointment', text: 'First Name\nLast Name\nDate of Birth\nEmail' };
    const directory = { ...form, url: 'https://www.healthgrades.com/request-an-appointment' };
    // Act
    const contacts = institutionContacts('Dana-Farber Cancer Institute', [form, directory], AT);
    // Assert
    expect(contacts.map((c) => [c.origin, c.evidence.claimType, c.evidence.claim])).toEqual([
      ['intake_form', 'contact_point.web_form.intake_form', form.url],
    ]);
  });
});
