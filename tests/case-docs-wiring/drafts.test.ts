import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingest, search, MemoryDocumentStore } from '../../lib/case-docs';
import { ingestCaseSummary } from '../../lib/case-docs';
import { createDraft } from '../../lib/outreach/draft';
import { createCallScript } from '../../lib/outreach/call-script';
import type { Contact } from '../../lib/outreach/types';
const contact: Contact = { id: 'contact-a', caseId: 'case-a', targetId: 'resource', targetKind: 'institution', channel: 'email', address: 'intake@example.test', state: 'drafted' };
const consent = { contactId: contact.id, sharedFields: ['diseaseName'], approvedAt: '2026-10-23' };
const record = { diseaseName: 'synthetic disease', insurer: 'SecretPlan', planId: 'secret-123' };
beforeEach(() => { vi.stubEnv('WAYFINDER_OFFLINE', '1'); });
afterEach(() => vi.unstubAllEnvs());
describe('consented document context', () => {
  it('retrieves offline context but never copies private or other-contact text into drafts or scripts', async () => {
    const store = new MemoryDocumentStore();
    await ingestCaseSummary({ id: contact.caseId, ...record }, store);
    const [publicDoc] = await ingest({ caseId: contact.caseId, contactId: contact.id, kind: 'resource_page', title: 'Intake', text: 'Intake hours are Monday mornings.', sourceUrl: 'https://example.test/intake' }, store);
    await ingest({ caseId: contact.caseId, contactId: 'contact-b', kind: 'inbound_message', sharedField: 'diseaseName', title: 'Other reply', text: 'Other contact private reply' }, store);
    const docs = await search({ caseId: contact.caseId, contactId: contact.id, allowedFields: consent.sharedFields, query: 'intake insurance', k: 20 }, store);
    expect(docs.map(d => d.content).join(' ')).not.toContain('SecretPlan');
    expect(docs.map(d => d.content).join(' ')).not.toContain('Other contact');
    const draft = createDraft(contact, consent, record, docs);
    const script = createCallScript({ ...contact, channel: 'voice' }, consent, record, docs);
    for (const output of [draft, script]) {
      expect(JSON.stringify(output)).not.toMatch(/SecretPlan|secret-123|Other contact/);
      expect(output.contextDocIds).toEqual([publicDoc.id]);
      expect(JSON.stringify(output)).toContain('https://example.test/intake');
    }
    expect(script.fallbacks.unsharedQuestion).toBe("I'll have the patient follow up");
    expect(script.facts.join(' ')).toContain('synthetic disease');
  });
  it('rejects tainted public context even if passed directly by a caller', async () => {
    const store = new MemoryDocumentStore();
    const docs = await ingest({ caseId: contact.caseId, kind: 'resource_page', title: 'Intake', sourceUrl: 'https://example.test', text: 'Insurance accepted: SecretPlan' }, store);
    expect(createDraft(contact, consent, record, docs).contextDocIds).toEqual([]);
    expect(JSON.stringify(createCallScript(contact, consent, record, docs))).not.toContain('SecretPlan');
  });
});

describe('draft context is scoped to the contact own target', () => {
  it('never uses case-wide or other-contact public docs about a different resource', async () => {
    const store = new MemoryDocumentStore();
    const trial = { ...contact, targetKind: 'trial' as const, channel: 'voice' as const };
    const own = await ingest({ caseId: contact.caseId, contactId: contact.id, kind: 'evidence', title: 'Trial', sourceUrl: 'https://clinicaltrials.gov/study/NCT05432466', text: 'Screening for the study runs through the central contact.' }, store);
    const caseWide = await ingest({ caseId: contact.caseId, kind: 'evidence', title: 'Travel', sourceUrl: 'https://example.test/travel', text: 'UniteRare lists travel grants.' }, store);
    const other = await ingest({ caseId: contact.caseId, contactId: 'contact-b', kind: 'evidence', title: 'Meds', sourceUrl: 'https://example.test/meds', text: 'NORD provides help with medications.' }, store);
    const docs = [...own, ...caseWide, ...other];
    expect(createCallScript(trial, consent, record, docs).contextDocIds).toEqual([own[0].id]);
    expect(createDraft(trial, consent, record, docs).contextDocIds).toEqual([own[0].id]);
  });
  it('store search for a contact returns only that contact docs when scoped', async () => {
    const store = new MemoryDocumentStore();
    await ingest({ caseId: contact.caseId, kind: 'evidence', title: 'Travel', sourceUrl: 'https://example.test/travel', text: 'travel grants' }, store);
    const [own] = await ingest({ caseId: contact.caseId, contactId: contact.id, kind: 'evidence', title: 'Own', sourceUrl: 'https://example.test/own', text: 'own page' }, store);
    const docs = await search({ caseId: contact.caseId, contactId: contact.id, contactOnly: true, allowedFields: [], query: 'travel grants', k: 5 }, store);
    expect(docs.map(d => d.id)).toEqual([own.id]);
  });
});

it('keeps the generated call script behind approval and the outbound gate', async () => {
  const { checkOutbound } = await import('../../lib/safety/outbound-gate');
  const { parseAllowlist } = await import('../../lib/safety/allowlist');
  const draft = createDraft({ ...contact, channel: 'voice', address: '+15555550123' }, consent, record);
  const input = { draft, caseRecord: record, consent, contacts: [{ ...contact, channel: 'voice', address: '+15555550123' }], allowlist: parseAllowlist('+15555550123'), now: '2026-10-23T12:00:00Z', mode: 'dev' as const };
  expect(checkOutbound(input).ok).toBe(false);
  expect(checkOutbound({ ...input, draft: { ...draft, approvedAt: input.now } }).ok).toBe(true);
});
