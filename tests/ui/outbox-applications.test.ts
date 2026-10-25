import { describe, expect, it, vi } from 'vitest';
import { approveApplicationRequest, docIdsOf, loadApplications, sourceLabel } from '@/components/outreach/applications';

const row = {
  id: 'app-1', caseId: 'case-1', contactId: 'k', url: 'https://aid.example.org/apply', screenshot: 'png', status: 'draft',
  approvedAt: null, submittedAt: null, missing: [],
  fields: [
    { fieldKey: 'diagnosis', label: 'Diagnosis', type: 'text', value: 'Synthetic', source: { kind: 'consent', key: 'diseaseName' } },
    { fieldKey: 'city', label: 'City', type: 'text', value: 'Boston', source: { kind: 'doc', docId: 'd1', snippet: 'lives in Boston' } },
    { fieldKey: 'notes', label: 'Notes', type: 'textarea', value: 'AI', source: { kind: 'disclosure' } },
  ],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('outbox applications client', () => {
  it('loads valid rows and drops malformed ones; failures are empty', async () => {
    const ok = await loadApplications('case-1', vi.fn(async () => json({ applications: [row, { id: 1 }] })) as never);
    expect(ok.map(a => a.id)).toEqual(['app-1']);
    expect(await loadApplications('case-1', vi.fn(async () => json({}, 500)) as never)).toEqual([]);
  });

  it('labels each value with where it came from', () => {
    expect(row.fields.map(f => sourceLabel(f as never))).toEqual([
      'Your case: Diagnosis (you ticked this)', 'Your document: "lives in Boston"', 'AI disclosure, written by Orelia',
    ]);
    expect(docIdsOf(row.fields as never)).toEqual(['d1']);
  });

  it('approval posts the ticked documents and maps refusals to plain words', async () => {
    const f = vi.fn(async () => json({ submittedAt: '2026-10-24T13:00:00Z' }));
    expect(await approveApplicationRequest('case-1', 'app-1', ['d1'], f as never)).toEqual({ ok: true, submittedAt: '2026-10-24T13:00:00Z' });
    expect(f).toHaveBeenCalledWith('/api/cases/case-1/applications/app-1/approve', expect.objectContaining({ method: 'POST', body: '{"sharedDocIds":["d1"]}' }));
    const refused = await approveApplicationRequest('case-1', 'app-1', [], vi.fn(async () => json({ reasons: ['not_allowlisted'] }, 422)) as never);
    expect(refused).toEqual({ ok: false, reasons: ['The address is not on the outbound allowlist, so nothing can be sent.'] });
  });
});
