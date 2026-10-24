import { describe, expect, it, vi } from 'vitest';
import type { ExaPort } from '@/lib/agents/research/source-ports';
import { enrichVerified } from '@/lib/agents/contact-enrichment';
import type { VerifyOutput } from '@/lib/agents/verifier';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const base = (): VerifyOutput => ({
  kept: [
    { key: 'institution:name:northgate genetics clinic', resource: { kind: 'institution', id: 'i-uuid', name: 'Northgate Genetics Clinic', evidenceRefs: ['ev1'] },
      evidence: [{ id: 'ev1', claimType: 'disease_program', claim: 'Genetics clinic', sourceUrl: 'https://northgate-genetics.example.org/clinic', sourceKind: 'exa', fetchedAt: NOW.toISOString() }] },
    { key: 'organization:url:x', resource: { kind: 'organization', id: 'o1', name: 'Group', evidenceRefs: [] }, evidence: [] },
  ],
  dropped: [], merged: [], conflicts: [],
});
const exa = (fn: ExaPort['search']): ExaPort => ({ search: vi.fn(fn) });

describe('enrichVerified', () => {
  it('adds an intake phone row with a verifier-style uuid and updates evidenceRefs', async () => {
    const out = await enrichVerified(base(), exa(async () => [{ url: 'https://northgate-genetics.example.org/appointments', title: 'Appointments', text: 'New patient appointments: 217-555-0142' }]), NOW);
    const inst = out.kept[0]!;
    const row = inst.evidence.find((e) => e.claimType === 'contact_point.voice.new_patient_line')!;
    expect(row.claim).toBe('+12175550142');
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(inst.resource.evidenceRefs).toContain(row.id);
    expect(out.kept[1]).toEqual(base().kept[1]);
  });

  it('returns the input unchanged when Exa fails or is too slow', async () => {
    const v = base();
    expect(await enrichVerified(v, exa(async () => { throw new Error('down'); }), NOW)).toEqual(v);
    const slow = exa(() => new Promise((r) => setTimeout(() => r([]), 200)));
    expect(await enrichVerified(v, slow, NOW, 10)).toEqual(v);
  });

  it('stamps an online form for an institution that has a phone but no email, and a role email for an aid organization', async () => {
    // Arrange
    const v = base();
    const inst = v.kept[0]!;
    const phone = { id: 'ph', claimType: 'contact_point.voice.new_patient_line', claim: '+12175550142', sourceUrl: 'https://northgate-genetics.example.org/clinic', sourceKind: 'exa' as const, fetchedAt: NOW.toISOString() };
    const withPhone: VerifyOutput = {
      ...v,
      kept: [
        { ...inst, evidence: [...inst.evidence, phone], resource: { ...inst.resource, evidenceRefs: ['ev1', 'ph'] } },
        { key: 'organization:url:https://aidfund.example.org/', resource: { kind: 'organization', id: 'o2', name: 'Northgate Aid Fund', organizationKind: 'financial_aid', url: 'https://aidfund.example.org/', evidenceRefs: [] }, evidence: [] },
      ],
    };
    const search = vi.fn(async ({ query }: { query: string }) => query.includes('Aid Fund')
      ? [{ url: 'https://aidfund.example.org/contact', title: 'Contact', text: 'Contact us: help@aidfund.example.org' }, { url: 'https://aidfund.example.org/contact', title: 'Contact', text: 'Contact us: info@aidfund.example.org' }]
      : [{ url: 'https://northgate-genetics.example.org/appointment-request', title: 'Appointment Request', text: 'First Name\nLast Name\nDate of Birth\nEmail\nReason for visit' }]);
    // Act
    const out = await enrichVerified(withPhone, { search } as unknown as ExaPort, NOW);
    // Assert
    const form = out.kept[0]!.evidence.find((e) => e.claimType === 'contact_point.web_form.intake_form')!;
    expect(form.claim).toBe('https://northgate-genetics.example.org/appointment-request');
    expect(out.kept[0]!.resource.evidenceRefs).toContain(form.id);
    const email = out.kept[1]!.evidence.find((e) => e.claimType === 'contact_point.email.org_contact')!;
    expect(email.claim).toBe('info@aidfund.example.org');
    expect(out.kept[1]!.resource.evidenceRefs).toEqual([email.id]);
  });
});
