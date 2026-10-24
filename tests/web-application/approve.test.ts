import { describe, expect, it, vi } from 'vitest';
import { approveApplication, type ApproveApplicationDeps } from '@/lib/web-application/approve';
import { MemoryApplicationStore } from '@/lib/web-application/store';
import type { WebApplicationDraft } from '@/lib/web-application/types';
import { isGatedDraft, type GatedDraft } from '@/lib/safety/outbound-gate';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { PageChangedError } from '@/lib/channels/web-form';

const URL_ = 'http://localhost:3000/dev/test-application';
const NOW = new Date('2026-10-24T12:00:00Z');
const record = { diseaseName: 'Epithelioid sarcoma', homeState: 'MA', insurer: 'Fictional Plan' };

function draft(over: Partial<WebApplicationDraft> = {}): WebApplicationDraft {
  return {
    id: 'app-1', caseId: 'case-1', contactId: 'contact-1', url: URL_,
    fields: [
      { fieldKey: 'diagnosis', label: 'Diagnosis', type: 'text', value: 'Epithelioid sarcoma', source: { kind: 'consent', key: 'diseaseName' } },
      { fieldKey: 'notes', label: 'Anything else', type: 'textarea', value: AI_DISCLOSURE_EMAIL, source: { kind: 'disclosure' } },
    ],
    missing: [], formFingerprint: 'f1-abc', screenshot: 'png', sharedFields: ['diseaseName'], sharedDocIds: [],
    status: 'draft', approvedAt: null, submittedAt: null, result: null, createdAt: NOW.toISOString(), ...over,
  };
}

async function setup(over: Partial<ApproveApplicationDeps> = {}, d: WebApplicationDraft = draft()) {
  const applications = new MemoryApplicationStore();
  await applications.save(d);
  const submitted: GatedDraft[] = [];
  const deps: ApproveApplicationDeps = {
    applications,
    outreach: {
      getCase: async () => record,
      consent: async () => ({ contactId: 'contact-1', sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' }),
      contacts: async () => [{ id: 'contact-1', caseId: 'case-1', state: 'drafted', address: 'intake@example.org' }],
    },
    submit: async gated => { submitted.push(gated); },
    env: { NODE_ENV: 'test', OUTBOUND_WEB_ALLOWLIST: 'localhost:3000' },
    clock: () => NOW,
    ...over,
  };
  return { applications, deps, submitted };
}

describe('approveApplication', () => {
  it('runs the outbound gate, then submits exactly once with a GatedDraft', async () => {
    const { applications, deps, submitted } = await setup();
    const res = await approveApplication('app-1', {}, deps);
    expect(res).toMatchObject({ ok: true, status: 'submitted' });
    expect(submitted).toHaveLength(1);
    expect(isGatedDraft(submitted[0])).toBe(true);
    expect(submitted[0].webForm?.fields.map(f => f.fieldKey)).toEqual(['diagnosis', 'notes']);
    expect(await applications.get('app-1')).toMatchObject({ status: 'submitted', approvedAt: NOW.toISOString() });
    const again = await approveApplication('app-1', {}, deps);
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(submitted).toHaveLength(1);
  });

  it('refuses off-allowlist forms and leaves the draft reviewable', async () => {
    const { applications, deps, submitted } = await setup({ env: { NODE_ENV: 'test', OUTBOUND_WEB_ALLOWLIST: '' } });
    expect(await approveApplication('app-1', {}, deps)).toMatchObject({ ok: false, status: 422, reasons: ['not_allowlisted'] });
    expect(submitted).toHaveLength(0);
    expect((await applications.get('app-1'))?.status).toBe('draft');
  });

  it('refuses a value the patient did not tick (consent changed after drafting)', async () => {
    const { deps, submitted } = await setup({
      outreach: {
        getCase: async () => record,
        consent: async () => ({ contactId: 'contact-1', sharedFields: [], approvedAt: '2026-10-24T11:00:00Z' }),
        contacts: async () => [],
      },
    });
    const res = await approveApplication('app-1', {}, deps);
    expect(res).toMatchObject({ ok: false, status: 422 });
    if (!res.ok) expect(res.reasons).toContain('unshared_field');
    expect(submitted).toHaveLength(0);
  });

  it('requires consent and a known application', async () => {
    const { deps } = await setup({ outreach: { getCase: async () => record, consent: async () => undefined, contacts: async () => [] } });
    expect(await approveApplication('app-1', {}, deps)).toMatchObject({ ok: false, status: 422, reasons: ['consent_required'] });
    expect(await approveApplication('nope', {}, deps)).toMatchObject({ ok: false, status: 404, reasons: ['application_not_found'] });
  });

  it('a document value needs the document ticked', async () => {
    const withDoc = draft({ fields: [...draft().fields, { fieldKey: 'city', label: 'City', type: 'text', value: 'Boston', source: { kind: 'doc', docId: 'doc-9', snippet: 'lives in Boston' } }] });
    const a = await setup({}, withDoc);
    expect(await approveApplication('app-1', { sharedDocIds: [] }, a.deps)).toMatchObject({ ok: false, status: 422, reasons: ['unshared_field'] });
    const b = await setup({}, withDoc);
    expect(await approveApplication('app-1', { sharedDocIds: ['doc-9'] }, b.deps)).toMatchObject({ ok: true });
    expect(b.submitted).toHaveLength(1);
  });

  it('a changed live form marks the application stale; other failures mark it failed without leaking detail', async () => {
    const stale = await setup({ submit: async () => { throw new PageChangedError('mock-browser'); } });
    expect(await approveApplication('app-1', {}, stale.deps)).toMatchObject({ ok: false, status: 409, reasons: ['page_changed'] });
    expect((await stale.applications.get('app-1'))?.status).toBe('stale');
    const err = vi.fn(async () => { throw new Error('provider said secret-token'); });
    const failed = await setup({ submit: err });
    const res = await approveApplication('app-1', {}, failed.deps);
    expect(res).toMatchObject({ ok: false, status: 502, reasons: ['submit_failed'] });
    expect(JSON.stringify(res)).not.toContain('secret');
    expect((await failed.applications.get('app-1'))?.status).toBe('failed');
  });

  it('an application to a resource the patient already contacts does not count as a sixth contact', async () => {
    const active = Array.from({ length: 5 }, (_, i) => ({ id: `contact-${i + 1}`, caseId: 'case-1', targetId: `target-${i + 1}`, state: 'sent', address: `p${i}@example.org` }));
    const consent = async () => ({ contactId: 'contact-1', sharedFields: ['diseaseName'], approvedAt: '2026-10-24T11:00:00Z' });
    const known = await setup({ outreach: { getCase: async () => record, consent, contacts: async () => active } });
    expect(await approveApplication('app-1', {}, known.deps)).toMatchObject({ ok: true });
    expect(known.submitted).toHaveLength(1);
    const unknown = await setup({ outreach: { getCase: async () => record, consent, contacts: async () => active } }, draft({ contactId: 'contact-9' }));
    expect(await approveApplication('app-1', {}, unknown.deps)).toMatchObject({ ok: false, status: 422, reasons: ['contact_cap'] });
    expect(unknown.submitted).toHaveLength(0);
  });
});
