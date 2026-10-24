import { describe, expect, it } from 'vitest';
import { webFormRowsFromPage, webFormsOnPage } from '@/lib/contact-finder/web-forms';
import { parsePlanContactPoints } from '@/lib/plan/contact-points';

const AT = '2026-01-01T00:00:00.000Z';
const appointment = {
  url: 'https://www.northgate-health.org/request-an-appointment#top',
  title: 'Request an Appointment | Northgate Health',
  text: 'Request an Appointment\nPlease fill out the form below and our team will call you within 2 business days.\nPatient First Name*\nPatient Last Name*\nDate of Birth (required)\nEmail Address\nPhone Number*\nReason for Visit\nSubmit',
};
const referral = {
  url: 'https://www.northgate-health.org/for-physicians/refer-a-patient',
  title: 'Refer a Patient',
  text: 'Physician referral form\nReferring Physician Name\nPatient Name\nDate of birth\nDiagnosis\nSubmit referral',
};
const aid = {
  url: 'https://www.rarefund.org/assistance/apply',
  title: 'Apply for Financial Assistance',
  text: 'Apply for travel and lodging assistance.\nFirst Name\nLast Name\nEmail\nHousehold Size\nAnnual Household Income\n* indicates required field',
};
const blog = {
  url: 'https://www.northgate-health.org/blog/how-to-prepare-for-your-appointment',
  title: 'How to prepare for your appointment',
  text: 'Before you request an appointment, gather your records. You can call our phone line or email the clinic.\nBring your insurance card.',
};

describe('webFormsOnPage', () => {
  it('detects a request-an-appointment page with field labels as an intake form (page URL, no fragment)', () => {
    // Arrange / Act
    const forms = webFormsOnPage(appointment);
    // Assert
    expect(forms).toEqual([{ origin: 'intake_form', url: 'https://www.northgate-health.org/request-an-appointment', sourceUrl: appointment.url, sourceKind: 'exa' }]);
  });

  it('classifies referral and financial-aid application forms', () => {
    expect(webFormsOnPage(referral).map((f) => f.origin)).toEqual(['referral_form']);
    expect(webFormsOnPage(aid).map((f) => f.origin)).toEqual(['application_form']);
  });

  it('ignores an article that mentions appointments but has no form fields', () => {
    expect(webFormsOnPage(blog)).toEqual([]);
  });

  it('requires a form-naming URL or title even when fields are present', () => {
    expect(webFormsOnPage({ ...appointment, url: 'https://www.northgate-health.org/about', title: 'About us' })).toEqual([]);
  });

  it('rejects non-http URLs, empty text, documents, job applications and login forms', () => {
    expect(webFormsOnPage({ ...appointment, url: 'ftp://northgate-health.org/request-an-appointment' })).toEqual([]);
    expect(webFormsOnPage({ ...appointment, url: 'not a url' })).toEqual([]);
    expect(webFormsOnPage({ ...appointment, text: '   ' })).toEqual([]);
    expect(webFormsOnPage({ ...appointment, url: 'https://www.northgate-health.org/request-an-appointment.pdf' })).toEqual([]);
    expect(webFormsOnPage({ ...aid, url: 'https://www.rarefund.org/careers/apply', title: 'Apply - Careers' })).toEqual([]);
    expect(webFormsOnPage({ ...appointment, text: `${appointment.text}\nPassword` })).toEqual([]);
  });

  it('needs a message box and email on a plain contact-us page', () => {
    const contact = { url: 'https://www.rarefund.org/contact-us', title: 'Contact Us', text: 'Name\nEmail\nPhone' };
    expect(webFormsOnPage(contact)).toEqual([]);
    expect(webFormsOnPage({ ...contact, text: 'Name\nEmail\nMessage' }).map((f) => f.origin)).toEqual(['intake_form']);
  });

  it('builds reserved evidence rows the planner parser accepts', () => {
    // Act
    const rows = webFormRowsFromPage(appointment, AT);
    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ claimType: 'contact_point.web_form.intake_form', claim: 'https://www.northgate-health.org/request-an-appointment', sourceKind: 'exa', fetchedAt: AT });
    expect(parsePlanContactPoints(rows).map((p) => [p.channel, p.address])).toEqual([['web_form', 'https://www.northgate-health.org/request-an-appointment']]);
    expect(webFormRowsFromPage(blog, AT)).toEqual([]);
  });
});
