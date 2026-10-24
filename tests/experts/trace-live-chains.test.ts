import { describe, expect, it, vi } from 'vitest';
import type { ExaPort, ExaResult, NppesPort, NppesProvider } from '@/lib/agents/research/source-ports';
import { affiliationEvidence } from '@/lib/identity/affiliation-evidence';
import { traceExperts, type TraceInput, type TraceInputEvidence } from '@/lib/experts/trace';
import { canVerifyByPhone } from '@/components/shortlist/verify-model';

/**
 * Live shape: experts loaded from Postgres carry no profile (no affiliation / state columns); the affiliation only
 * survives as a code-stamped identity.affiliation evidence row. Chains must still reach the institution, and NPPES /
 * institution intake pages supply phone contact points.
 */
const NOW = new Date('2026-01-02T03:04:05.000Z');
const INST = 'Northgate University Medical Center';
const AFFIL = `Department of Genetics, ${INST}, Springfield, IL, USA`;
const AT = NOW.toISOString();

const provider = (over: Partial<NppesProvider> & { phone?: string; org?: string } = {}): NppesProvider => ({
  npi: '1234567890', firstName: 'Ada', lastName: 'Example', taxonomy: 'Clinical Genetics (M.D.)', state: 'IL', city: 'Springfield',
  raw: {
    number: '1234567890', enumeration_type: 'NPI-1', basic: over.org ? { organization_name: over.org } : {},
    taxonomies: [{ code: '207SG0201X', desc: 'Clinical Genetics (M.D.)', primary: true }],
    addresses: [
      { address_purpose: 'MAILING', city: 'Springfield', state: 'IL', telephone_number: '217-555-0111' },
      { address_purpose: 'LOCATION', city: 'Springfield', state: 'IL', ...(over.phone === '' ? {} : { telephone_number: over.phone ?? '217-555-0100' }) },
    ],
  } as never,
  ...over,
});
const nppes = (providers: NppesProvider[]) => {
  const lookup = vi.fn(async () => ({ searchUrl: 'https://npiregistry.cms.hhs.gov/api/?x', providers }));
  return { port: { lookup } as NppesPort, lookup };
};
const exa = (byQuery: (q: string) => ExaResult[]): ExaPort => ({ async search({ query }) { return byQuery(query); } });
const noExa = exa(() => []);

const authorship = (pmid: string): TraceInputEvidence => ({
  targetKind: 'expert', targetId: 'e1', claimType: 'disease_publications', claim: `Ada Example is listed as an author of PMID ${pmid}.`,
  sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, sourceKind: 'pubmed', fetchedAt: AT,
});
const affRow = (pmid: string, text = AFFIL): TraceInputEvidence => ({ ...affiliationEvidence({ name: 'Ada Example', pmid, affiliation: text, fetchedAt: AT })!, targetKind: 'expert', targetId: 'e1' });

const input = (evidence: TraceInputEvidence[]): TraceInput => ({
  caseId: 'case-1', diseaseName: 'Vascular Ehlers-Danlos syndrome',
  experts: [{ id: 'e1', name: 'Ada Example', npi: null }],
  evidence,
});

describe('tracer on live-shaped data (no profile, identity.affiliation rows)', () => {
  it('reaches the institution from the stored affiliation row and cites that PubMed record', async () => {
    const t = await traceExperts(input([authorship('111'), affRow('111')]), { nppes: nppes([]).port, exa: noExa, now: NOW });
    const c = t.chains[0]!;
    expect(c.institution.name).toBe(INST);
    const cited = t.evidence.find((e) => c.institution.evidenceIds.includes(e.id) && e.claimType === 'experts.affiliation')!;
    expect(cited.sourceUrl).toBe('https://pubmed.ncbi.nlm.nih.gov/111/');
    expect(cited.claim).toContain('PMID 111');
  });

  it('looks NPPES up in the affiliation state when no profile state exists', async () => {
    const n = nppes([provider()]);
    await traceExperts(input([authorship('111'), affRow('111')]), { nppes: n.port, exa: noExa, now: NOW });
    expect(n.lookup).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Ada', lastName: 'Example', state: 'IL' }));
  });

  it('a confirmed NPPES match adds the practice-location phone (never the mailing phone) as a voice route', async () => {
    const t = await traceExperts(input([authorship('111'), affRow('111')]), { nppes: nppes([provider()]).port, exa: noExa, now: NOW });
    const c = t.chains[0]!;
    expect(c.seesPatients.verdict).toBe('yes');
    const voice = c.howToReach.filter((r) => r.channel === 'voice');
    expect(voice.map((r) => r.address)).toEqual(['+12175550100']);
    const row = t.evidence.find((e) => e.id === voice[0]!.evidenceId)!;
    expect(row).toMatchObject({ claimType: 'contact_point.voice.nppes_location_phone', sourceKind: 'nppes', sourceUrl: 'https://npiregistry.cms.hhs.gov/provider-view/1234567890', targetKind: 'expert', targetId: 'e1' });
    expect(voice[0]!.label).toMatch(/registry/i);
  });

  it('no confirmed NPPES match means no NPPES phone', async () => {
    const t = await traceExperts(input([authorship('111'), affRow('111')]), { nppes: nppes([provider(), provider({ npi: '1234567891' })]).port, exa: noExa, now: NOW });
    expect(t.chains[0]!.howToReach.filter((r) => r.channel === 'voice')).toEqual([]);
  });

  it('falls back to the NPPES organization / practice location when no affiliation exists', async () => {
    const t = await traceExperts(input([authorship('111')]), { nppes: nppes([provider({ org: 'Northgate Genetics Clinic' })]).port, exa: noExa, now: NOW });
    const c = t.chains[0]!;
    // Without an affiliation there is no location anchor, so NPPES cannot confirm the person: institution stays unknown.
    expect(c.institution.name).toBeNull();
    expect(c.seesPatients.verdict).toBe('unknown');
  });

  it('uses the NPPES organization name when the affiliation names no institution but anchors the location', async () => {
    const t = await traceExperts(input([authorship('111'), affRow('111', 'Department of Genetics, Springfield, IL, USA')]), { nppes: nppes([provider({ org: 'Northgate Genetics Clinic' })]).port, exa: noExa, now: NOW });
    const c = t.chains[0]!;
    expect(c.institution.name).toBe('Northgate Genetics Clinic');
    const row = t.evidence.find((e) => c.institution.evidenceIds.includes(e.id))!;
    expect(row.sourceKind).toBe('nppes');
  });

  it('stamps a new-patient phone from an institution intake page on the institution host', async () => {
    const intake: ExaResult = { url: 'https://www.northgate.example.org/genetics/appointments', title: `${INST} Genetics`, text: 'Genetics clinic\nNew patient appointments: (217) 555-0142\nFax: 217-555-0143' };
    const offDomain: ExaResult = { url: 'https://directory.example.com/northgate', title: `${INST}`, text: 'New patient appointments: 217-555-0199' };
    const t = await traceExperts(input([authorship('111'), affRow('111')]), {
      nppes: nppes([]).port, exa: exa((q) => (/new patient/i.test(q) ? [intake, offDomain] : [])), now: NOW,
    });
    const voice = t.chains[0]!.howToReach.filter((r) => r.channel === 'voice');
    expect(voice.map((r) => r.address)).toEqual(['+12175550142']);
    const row = t.evidence.find((e) => e.id === voice[0]!.evidenceId)!;
    expect(row).toMatchObject({ claimType: 'contact_point.voice.new_patient_line', sourceKind: 'exa', sourceUrl: intake.url, targetKind: 'institution' });
  });

  it('a shortlist card holding the stamped NPPES row can be verified by phone', async () => {
    const t = await traceExperts(input([authorship('111'), affRow('111')]), { nppes: nppes([provider()]).port, exa: noExa, now: NOW });
    const row = t.evidence.find((e) => e.claimType.startsWith('contact_point.voice'))!;
    const card = { resource: { kind: 'expert', id: 'e1', name: 'Ada Example', evidenceRefs: [] }, evidence: [row] } as never;
    expect(canVerifyByPhone(card)).toBe(true);
  });
});
