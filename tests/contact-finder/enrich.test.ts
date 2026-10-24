import { describe, expect, it, vi } from 'vitest';
import type { ExaPort, ExaResult } from '@/lib/agents/research/source-ports';
import { enrichInstitutions, enrichmentQuery, formQuery, institutionContactRows, onInstitutionSite, organizationContactQuery, ownHosts } from '@/lib/contact-finder/enrich';
import { canVerifyByPhone } from '@/components/shortlist/verify-model';

const AT = '2026-01-01T00:00:00.000Z';
const page: ExaResult = { url: 'https://my.clevelandclinic.org/departments/genetics/appointments', title: 'Genomic Medicine Institute', text: 'Genomic Medicine Institute\nNew patient appointments: 216-444-5000\nFax: 216-444-0001' };
const directory: ExaResult = { url: 'https://www.healthgrades.com/cleveland-clinic', title: 'Cleveland Clinic', text: 'New patient appointments: 216-555-0199' };
const exa = (results: ExaResult[]) => { const search = vi.fn(async () => results); return { port: { search } as ExaPort, search }; };
const target = (over = {}) => ({
  targetKind: 'institution' as const, targetId: 'i1', name: 'Cleveland Clinic Genomic Medicine Institute',
  evidence: [{ claimType: 'disease_program', claim: 'Genomic Medicine Institute', sourceUrl: 'https://my.clevelandclinic.org/departments/genomic-medicine', sourceKind: 'exa' }],
  ...over,
});

describe('institution contact enrichment', () => {
  it('own hosts come from the institution evidence pages that carry a name token', () => {
    expect(ownHosts('Cleveland Clinic Genomic Medicine Institute', target().evidence)).toEqual(['my.clevelandclinic.org']);
    expect(ownHosts('Northgate Center', [{ claimType: 'nci_designation', claim: 'x', sourceUrl: 'https://www.cancer.gov/x', sourceKind: 'nci' }])).toEqual([]);
  });

  it('accepts only pages on the institution site', () => {
    expect(onInstitutionSite('Cleveland Clinic Genomic Medicine Institute', page.url, ['my.clevelandclinic.org'])).toBe(true);
    expect(onInstitutionSite('Cleveland Clinic Genomic Medicine Institute', directory.url, ['my.clevelandclinic.org'])).toBe(false);
    expect(onInstitutionSite('Dana-Farber Harvard Cancer Center', 'https://www.dana-farber.org/appointments', [])).toBe(true);
    expect(onInstitutionSite('Dana-Farber Harvard Cancer Center', 'https://www.cancer.gov/dana-farber-harvard', [])).toBe(false);
  });

  it('stamps the intake phone (not the fax, not a directory listing) with the page as source', async () => {
    const rows = await institutionContactRows(target(), exa([page, directory]).port, AT);
    expect(rows.map((r) => [r.claimType, r.claim, r.sourceUrl, r.sourceKind])).toEqual([
      ['contact_point.voice.new_patient_line', '+12164445000', page.url, 'exa'],
    ]);
    const card = { resource: { kind: 'institution', id: 'i1', name: 'x', evidenceRefs: [] }, evidence: [...target().evidence, ...rows] } as never;
    expect(canVerifyByPhone(card)).toBe(true);
  });

  it('skips institutions that already have a phone and an online form, and never throws on search failure', async () => {
    const withPhone = target({ evidence: [...target().evidence,
      { id: 'cp', claimType: 'contact_point.voice.new_patient_line', claim: '+12164445000', sourceUrl: page.url, sourceKind: 'exa' },
      { id: 'wf', claimType: 'contact_point.web_form.intake_form', claim: 'https://my.clevelandclinic.org/request-an-appointment', sourceUrl: 'https://my.clevelandclinic.org/request-an-appointment', sourceKind: 'exa' }] });
    const e = exa([page]);
    expect(await institutionContactRows(withPhone, e.port, AT)).toEqual([]);
    expect(e.search).not.toHaveBeenCalled();
    const failing: ExaPort = { search: async () => { throw new Error('exa down'); } };
    expect(await institutionContactRows(target(), failing, AT)).toEqual([]);
  });

  it('enriches a bounded number of targets and returns rows by target id', async () => {
    const targets = Array.from({ length: 12 }, (_, i) => target({ targetId: `i${i}` }));
    const e = exa([page]);
    const out = await enrichInstitutions(targets, e.port, AT);
    // Each of the 8 institutions gains its phone from the first search, so it also gets the online-form search.
    expect(e.search).toHaveBeenCalledTimes(16);
    expect(out.size).toBe(8);
  });

  it('runs the online-form search after the phone search for an institution that had no phone', async () => {
    // Arrange
    const form: ExaResult = { url: 'https://my.clevelandclinic.org/webappointment', title: 'Request an Appointment', text: 'Request an appointment online. To fill out this form, enter the patient name, date of birth and reason for visit.' };
    const search = vi.fn(async ({ query }: { query: string }) => (query === formQuery('Cleveland Clinic Genomic Medicine Institute') ? [form] : [page]));
    // Act
    const rows = await institutionContactRows(target(), { search } as ExaPort, AT);
    // Assert
    expect(search).toHaveBeenCalledTimes(2);
    expect(rows.map((r) => r.claimType)).toEqual(['contact_point.voice.new_patient_line', 'contact_point.web_form.intake_form']);
  });

  it('still runs the form search when the phone search filled its rows', async () => {
    // Arrange: a phone directory page with many intake lines.
    const directoryPage: ExaResult = { url: 'https://my.clevelandclinic.org/about/contact/phone-directory', title: 'Phone Directory', text: 'New patient appointments: 216-444-5000\nNew patient appointments: 216-444-5001\nNew patient appointments: 216-444-5002\nNew patient appointments: 216-444-5003\nReferrals: 216-444-5004' };
    const form: ExaResult = { url: 'https://my.clevelandclinic.org/webappointment', title: 'Request an Appointment', text: 'Request an appointment online. To fill out this form, enter the patient name, date of birth and reason for visit.' };
    const search = vi.fn(async ({ query }: { query: string }) => (query === formQuery('Cleveland Clinic Genomic Medicine Institute') ? [form] : [directoryPage]));
    // Act
    const rows = await institutionContactRows(target(), { search } as ExaPort, AT);
    // Assert
    expect(rows.filter((r) => r.claimType.startsWith('contact_point.voice.')).length).toBeLessThanOrEqual(3);
    expect(rows.some((r) => r.claimType === 'contact_point.web_form.intake_form')).toBe(true);
  });

  it('searches for a form page when an institution has a phone but no email or online form, and stamps the form', async () => {
    // Arrange
    const phoneRow = { id: 'cp', claimType: 'contact_point.voice.new_patient_line', claim: '+12164445000', sourceUrl: page.url, sourceKind: 'exa' };
    const withPhone = target({ evidence: [...target().evidence, phoneRow] });
    const form: ExaResult = { url: 'https://my.clevelandclinic.org/appointments/request-an-appointment', title: 'Request an Appointment',
      text: 'Request an appointment\nFirst Name*\nLast Name*\nDate of Birth\nEmail\nPhone\nNew patient appointments: 216-444-5000' };
    const e = exa([form, { ...form, url: 'https://www.healthgrades.com/request-an-appointment' }]);
    // Act
    const rows = await institutionContactRows(withPhone, e.port, AT);
    // Assert
    expect(e.search).toHaveBeenCalledWith({ query: formQuery(withPhone.name), numResults: 5 });
    expect(rows.map((r) => [r.claimType, r.claim])).toEqual([['contact_point.web_form.intake_form', form.url]]);
  });

  it('organizations without an email search their own site for a role email or an application form', async () => {
    // Arrange
    const org = { targetKind: 'organization' as const, targetId: 'o1', name: 'Rare Sarcoma Travel Fund', siteUrl: 'https://www.rstf.org/', evidence: [] };
    const contact: ExaResult = { url: 'https://www.rstf.org/contact', title: 'Contact', text: 'Contact us: info@rstf.org\nStaff: jane.doe@rstf.org' };
    const apply: ExaResult = { url: 'https://www.rstf.org/apply', title: 'Apply for a travel grant', text: 'First Name\nLast Name\nEmail\nHousehold Size\nSubmit application' };
    const offSite: ExaResult = { url: 'https://www.charitynavigator.org/rstf/contact', title: 'Contact', text: 'Contact us: info@charitynavigator.org' };
    const e = exa([contact, apply, offSite]);
    // Act
    const rows = await institutionContactRows(org, e.port, AT);
    // Assert
    expect(e.search).toHaveBeenCalledWith({ query: organizationContactQuery(org.name), numResults: 5 });
    expect(rows.map((r) => [r.claimType, r.claim])).toEqual([
      ['contact_point.email.org_contact', 'info@rstf.org'],
      ['contact_point.web_form.application_form', apply.url],
    ]);
    expect(enrichmentQuery({ ...org, evidence: [{ id: 'e', claimType: 'contact_point.email.org_contact', claim: 'info@rstf.org', sourceUrl: contact.url, sourceKind: 'exa' }] })).toBeNull();
  });

  it('caps organizations separately and puts phone-less institutions first', async () => {
    // Arrange
    const phoneRow = { id: 'cp', claimType: 'contact_point.voice.new_patient_line', claim: '+12164445000', sourceUrl: page.url, sourceKind: 'exa' };
    const targets = [
      ...Array.from({ length: 6 }, (_, i) => target({ targetId: `p${i}`, evidence: [...target().evidence, phoneRow] })),
      ...Array.from({ length: 6 }, (_, i) => target({ targetId: `n${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ targetKind: 'organization' as const, targetId: `o${i}`, name: 'Rare Sarcoma Travel Fund', evidence: [] })),
    ];
    const e = exa([]);
    // Act
    await enrichInstitutions(targets, e.port, AT);
    // Assert
    const queries = e.search.mock.calls.map((c) => (c as unknown as [{ query: string }])[0].query);
    expect(queries.filter((q) => q === formQuery(target().name))).toHaveLength(2);
    expect(queries.filter((q) => q === organizationContactQuery('Rare Sarcoma Travel Fund'))).toHaveLength(4);
    expect(queries).toHaveLength(12);
  });
});
