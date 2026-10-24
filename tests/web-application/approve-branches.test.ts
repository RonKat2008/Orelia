import { describe, expect, it, vi } from 'vitest';
import { approveApplication, usedDocIds, type ApproveApplicationDeps } from '@/lib/web-application/approve';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';

const NOW = new Date('2026-10-24T12:00:00Z');
const record = { diseaseName: 'Epithelioid sarcoma', homeState: 'MA', insurer: 'Fictional Plan' };
const consent = { contactId: 'contact-1', sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' };

const draft = (over: Partial<WebApplicationDraft> = {}): WebApplicationDraft => ({
  id: 'app-1', caseId: 'case-1', contactId: 'contact-1', url: 'http://localhost:3000/dev/test-application',
  fields: [
    { fieldKey: 'diagnosis', label: '', type: 'text', value: 'Epithelioid sarcoma', source: { kind: 'consent', key: 'diseaseName' } },
    { fieldKey: 'notes', label: 'Anything else', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
  ],
  missing: [], formFingerprint: 'f1', screenshot: null, sharedFields: ['diseaseName'], sharedDocIds: [], status: 'draft',
  approvedAt: null, submittedAt: null, result: null, createdAt: NOW.toISOString(), ...over,
});

async function setup(over: Partial<ApproveApplicationDeps> = {}, d = draft()) {
  const applications = new MemoryApplicationStore();
  await applications.save(d);
  const submit = vi.fn(async () => {});
  const deps: ApproveApplicationDeps = {
    applications,
    outreach: { getCase: async () => record, consent: async () => consent, contacts: async () => [] },
    submit, env: { NODE_ENV: 'test', OUTBOUND_WEB_ALLOWLIST: 'localhost:3000' }, clock: () => NOW, ...over,
  };
  return { applications, deps, submit };
}

describe('usedDocIds', () => {
  it('returns unique document ids only from doc-sourced fields', () => {
    const doc = (id: string) => ({ fieldKey: id, label: id, type: 'text', value: 'v', source: { kind: 'doc' as const, docId: id, snippet: 's' } });
    expect(usedDocIds({ fields: [doc('d1'), doc('d1'), doc('d2'), draft().fields[0]] })).toEqual(['d1', 'd2']);
    expect(usedDocIds({ fields: [] })).toEqual([]);
  });
});

describe('approveApplication refusals', () => {
  it('requires consent when the draft is not linked to a contact', async () => {
    const consentSpy = vi.fn(async () => consent);
    const { deps, submit } = await setup({ outreach: { getCase: async () => record, consent: consentSpy, contacts: async () => [] } }, draft({ contactId: null }));
    expect(await approveApplication('app-1', {}, deps)).toEqual({ ok: false, status: 422, reasons: ['consent_required'] });
    expect(consentSpy).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('requires consent to be approved, not merely present', async () => {
    const { deps } = await setup({ outreach: { getCase: async () => record, consent: async () => ({ ...consent, approvedAt: '' }), contacts: async () => [] } });
    expect(await approveApplication('app-1', {}, deps)).toMatchObject({ ok: false, status: 422, reasons: ['consent_required'] });
  });
  it('404s when the case no longer exists and leaves the draft reviewable', async () => {
    const { deps, applications, submit } = await setup({ outreach: { getCase: async () => undefined, consent: async () => consent, contacts: async () => [] } });
    expect(await approveApplication('app-1', {}, deps)).toEqual({ ok: false, status: 404, reasons: ['case_not_found'] });
    expect((await applications.get('app-1'))?.status).toBe('draft');
    expect(submit).not.toHaveBeenCalled();
  });
  it('409s without submitting when the draft->approved compare-and-set loses a race', async () => {
    const { deps, applications, submit } = await setup();
    vi.spyOn(applications, 'approve').mockResolvedValue(false);
    expect(await approveApplication('app-1', {}, deps)).toEqual({ ok: false, status: 409, reasons: ['already_approved'] });
    expect(submit).not.toHaveBeenCalled();
  });
  it('409s without submitting when the submit claim is lost', async () => {
    const { deps, applications, submit } = await setup();
    vi.spyOn(applications, 'claimSubmit').mockResolvedValue(false);
    expect(await approveApplication('app-1', {}, deps)).toEqual({ ok: false, status: 409, reasons: ['already_approved'] });
    expect(submit).not.toHaveBeenCalled();
  });
  it('uses process env and the system clock by default, which refuses an unlisted form host', async () => {
    const { deps } = await setup();
    const bare: ApproveApplicationDeps = { ...deps, env: undefined, clock: undefined };
    const res = await approveApplication('app-1', {}, bare);
    expect(res).toMatchObject({ ok: false, status: 422 });
  });
});

describe('approveApplication success paths', () => {
  it('passes the contact target id to the gate and honours explicitly ticked documents', async () => {
    const { deps, applications, submit } = await setup({
      outreach: { getCase: async () => record, consent: async () => consent, contacts: async () => [{ id: 'contact-1', caseId: 'case-1', targetId: 't-1', state: 'drafted', address: 'a@example.org' } as never] },
    });
    const res = await approveApplication('app-1', { sharedDocIds: [] }, deps);
    expect(res).toMatchObject({ ok: true });
    expect(submit).toHaveBeenCalledTimes(1);
    expect((await applications.get('app-1'))?.sharedDocIds).toEqual([]);
  });
  it('reports a non-Error submit failure as submit_failed without leaking detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps, applications } = await setup({ submit: async () => { throw 'provider detail with secret'; } });
    expect(await approveApplication('app-1', {}, deps)).toEqual({ ok: false, status: 502, reasons: ['submit_failed'] });
    expect((await applications.get('app-1'))?.result).toEqual({ reason: 'submit_failed' });
  });
});
