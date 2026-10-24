import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import { buildChecklists, updateRequirement } from '@/lib/coordination/requirements/service';
import type { RequirementsDeps } from '@/lib/coordination/requirements/deps';
import type { PlanResourceInput } from '@/lib/plan/contract';

const CASE = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-24T12:00:00.000Z');
const PAGE = 'https://clinic.example.org/new-patients';
const resource = (over: Partial<PlanResourceInput> = {}): PlanResourceInput => ({
  targetKind: 'institution', targetId: 'abc-123', name: 'Synthetic Clinic', contactId: null,
  evidence: [{ id: 'ev1', claimType: 'center_page', claim: 'Patients need a referral letter from their physician.', sourceUrl: PAGE, sourceKind: 'exa' }],
  ...over,
});
const deps = (over: Partial<RequirementsDeps> = {}): RequirementsDeps => ({
  exa: null, probe: null, offline: false, now: () => NOW,
  listDocs: async () => [], ...over,
});

let store: MemoryCoordinationStore;
beforeEach(() => { store = new MemoryCoordinationStore(); });

describe('buildChecklists', () => {
  it('reads evidence rows, assigns ids, saves version 1 and statuses against documents', async () => {
    const d = deps({ listDocs: async () => [{ id: 'doc-1', title: 'Referral letter Dr. S', kind: 'patient_note' }] });
    const [c] = await buildChecklists(CASE, [resource()], d, store);
    expect(c.resourceKey).toBe('institution:abc-123');
    expect(c.version).toBe(1);
    expect(c.requirements).toHaveLength(1);
    expect(c.requirements[0]).toMatchObject({ id: 'r1', kind: 'referral_letter', status: 'have', matchedDocId: 'doc-1', origin: 'evidence', sourceUrl: PAGE });
    expect(await store.get(CASE, 'checklist', 'institution:abc-123')).toMatchObject({ version: 1 });
  });

  it('uses Exa restricted to the resource domain and drops off-domain results', async () => {
    const search = vi.fn(async () => ({ records: [
      { url: 'https://clinic.example.org/referrals', text: 'Please send your pathology slides before the visit.' },
      { url: 'https://evil.example.net/referrals', text: 'Prior authorization required.' },
    ] }));
    const [c] = await buildChecklists(CASE, [resource()], deps({ exa: { search } }), store);
    expect(search).toHaveBeenCalled();
    expect(c.requirements.map(r => r.sourceUrl)).not.toContain('https://evil.example.net/referrals');
    expect(c.requirements.find(r => r.kind === 'records')).toMatchObject({ origin: 'exa', sourceUrl: 'https://clinic.example.org/referrals', status: 'missing' });
    expect(c.checkedUrls).toContain('https://clinic.example.org/referrals');
    for (const r of c.requirements) expect(c.checkedUrls).toContain(r.sourceUrl);
  });

  it('survives an Exa failure and still returns evidence-based requirements', async () => {
    const search = vi.fn(async () => { throw new Error('boom'); });
    const [c] = await buildChecklists(CASE, [resource()], deps({ exa: { search } }), store);
    expect(c.requirements).toHaveLength(1);
  });

  it('probes a web-form contact point and lists required fields (kernel origin)', async () => {
    const formUrl = 'https://clinic.example.org/intake';
    const r = resource({ evidence: [{ id: 'ev2', claimType: 'contact_point.web_form.intake_form', claim: formUrl, sourceUrl: PAGE, sourceKind: 'exa' }] });
    const probe = vi.fn(async () => ({ fields: [{ key: 'n', label: 'Full name', type: 'text' as const, required: true }] }));
    const [c] = await buildChecklists(CASE, [r], deps({ probe }), store);
    expect(probe).toHaveBeenCalledWith(formUrl);
    expect(c.requirements.some(q => q.origin === 'kernel' && q.sourceUrl === formUrl && q.kind === 'intake_form')).toBe(true);
    expect(c.requirements.some(q => q.origin === 'evidence' && q.kind === 'intake_form')).toBe(true);
  });

  it('offline: no network deps used; synthetic fixture pages by domain', async () => {
    const search = vi.fn(); const probe = vi.fn();
    const r = resource({ evidence: [{ id: 'e', claimType: 'center_page', claim: 'Leading synthetic center.', sourceUrl: 'https://synthetic-center.example.org/about', sourceKind: 'exa' }] });
    const [c] = await buildChecklists(CASE, [r], deps({ offline: true, exa: { search } as never, probe }), store);
    expect(search).not.toHaveBeenCalled(); expect(probe).not.toHaveBeenCalled();
    expect(new Set(c.requirements.map(q => q.kind))).toEqual(new Set(['referral_letter', 'records', 'insurance_preauth', 'intake_form', 'econsult']));
    expect(c.requirements.every(q => q.origin === 'fixture')).toBe(true);
  });

  it('records an unavailable reason when nothing is found', async () => {
    const r = resource({ evidence: [] });
    const [c] = await buildChecklists(CASE, [r], deps(), store);
    expect(c.requirements).toEqual([]);
    expect(c.unavailableReason).toMatch(/no referral requirements/i);
  });

  it('refresh bumps the version and keeps the patient status and note', async () => {
    await buildChecklists(CASE, [resource()], deps(), store);
    const first = (await store.get(CASE, 'checklist', 'institution:abc-123'))!;
    await updateRequirement(CASE, { resourceKey: first.resourceKey, version: 1, requirementId: 'r1', status: 'patient_to_request', note: 'asked Dr. Lee' }, deps(), store);
    const [again] = await buildChecklists(CASE, [resource()], deps(), store);
    expect(again.version).toBe(3);
    expect(again.requirements[0]).toMatchObject({ status: 'patient_to_request', note: 'asked Dr. Lee' });
    expect(again.createdAt).toBe(first.createdAt);
  });

  it('only builds the requested resourceKey', async () => {
    const other = resource({ targetId: 'zzz', name: 'Other' });
    const out = await buildChecklists(CASE, [resource(), other], deps(), store, 'institution:zzz');
    expect(out.map(c => c.resourceKey)).toEqual(['institution:zzz']);
  });
});

describe('updateRequirement', () => {
  it('updates status and note; conflict on stale version; not found otherwise', async () => {
    await buildChecklists(CASE, [resource()], deps(), store);
    const ok = await updateRequirement(CASE, { resourceKey: 'institution:abc-123', version: 1, requirementId: 'r1', status: 'missing', note: null }, deps(), store);
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') { expect(ok.checklist.version).toBe(2); expect(ok.checklist.requirements[0].status).toBe('missing'); }
    expect((await updateRequirement(CASE, { resourceKey: 'institution:abc-123', version: 1, requirementId: 'r1', status: 'have' }, deps(), store)).kind).toBe('conflict');
    expect((await updateRequirement(CASE, { resourceKey: 'institution:abc-123', version: 2, requirementId: 'nope', status: 'have' }, deps(), store)).kind).toBe('not_found');
    expect((await updateRequirement(CASE, { resourceKey: 'institution:none', version: 1, requirementId: 'r1', status: 'have' }, deps(), store)).kind).toBe('not_found');
  });
});
