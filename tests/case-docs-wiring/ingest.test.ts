import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryDocumentStore } from '../../lib/case-docs';
import { ingestInbound } from '../../lib/inbox/ingest';
import { MemoryPersist } from '../../lib/agents/persist';
import type { InboxDeps } from '../../lib/agents/inbox';
beforeEach(() => vi.stubEnv('WAYFINDER_OFFLINE', '1'));
afterEach(() => vi.unstubAllEnvs());
it.each(['email', 'voice'] as const)('stores verified %s inbound privately and gives classifier a scoped tool', async channel => {
  const documents = new MemoryDocumentStore();
  const classify = vi.fn(async (_input: import('../../lib/inbox/classifier').ClassifyInput) => ({ class: 'unclear' as const, confidence: 1, rationale: 'Review' }));
  const deps: InboxDeps = { documents, classifier: { classify }, lookupThread: () => 'contact-a', loadContext: () => ({ caseId: 'case-a', contactId: 'contact-a', resourceName: 'Office', consent: { sharedFields: ['diseaseName'] }, caseRecord: { diseaseName: 'synthetic', insurer: 'SecretPlan' } }) };
  await ingestInbound({ channel, providerThreadId: 'thread', body: 'What insurance? SecretPlan', receivedAt: '2026-10-23' }, { ...deps, tasks: { saveTasks: async tasks => tasks } } as Parameters<typeof ingestInbound>[1]);
  const rows = await documents.list('case-a');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ contactId: 'contact-a', kind: channel === 'voice' ? 'call_transcript' : 'inbound_message', sharedField: 'unshared' });
  const input = classify.mock.calls[0][0] as unknown as { tools: { handler: (input: { query: string }) => Promise<unknown> }[] };
  expect(input.tools).toHaveLength(1);
  expect(JSON.stringify(await input.tools[0].handler({ query: 'insurance' }))).not.toContain('SecretPlan');
});
it('ingests persisted verified evidence with its wrapper URL', async () => {
  const documents = new MemoryDocumentStore();
  const persist = new MemoryPersist(documents);
  await persist.saveResults('case-a', [{ record: { key: 'organization:org', resource: { id: 'org', kind: 'organization', name: 'Support', evidenceRefs: ['ev'] }, evidence: [{ id: 'ev', claim: 'Intake hours: Monday', claimType: 'intake', sourceUrl: 'https://example.test', sourceKind: 'exa', fetchedAt: '2026-10-23T00:00:00Z' }] }, score: 1, rank: 1, breakdown: [] }]);
  expect(await documents.list('case-a')).toEqual([expect.objectContaining({ kind: 'evidence' })]);
});
