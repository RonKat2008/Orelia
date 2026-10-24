import { describe, expect, it, vi } from 'vitest';
import type { ExaPort, ExaResult } from '@/lib/agents/research/source-ports';
import { enrichInstitutions, institutionContactRows, onInstitutionSite, ownHosts } from '@/lib/contact-finder/enrich';
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

  it('skips institutions that already have a phone and never throws on search failure', async () => {
    const withPhone = target({ evidence: [...target().evidence, { id: 'cp', claimType: 'contact_point.voice.new_patient_line', claim: '+12164445000', sourceUrl: page.url, sourceKind: 'exa' }] });
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
    expect(e.search).toHaveBeenCalledTimes(8);
    expect(out.size).toBe(8);
  });
});
