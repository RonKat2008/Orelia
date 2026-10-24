import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCoordinationStore } from '@/lib/coordination/store';
import type { HistorySource } from '@/lib/coordination/packet/history';
import { caseDocsHistorySource } from '@/lib/coordination/packet/history';
import { MemoryDocumentStore } from '@/lib/case-docs/store';
import { detectConflicts, buildSections, TEMPLATE_QUESTIONS } from '@/lib/coordination/packet/extract';
import { renderPacketText, PACKET_HEADER } from '@/lib/coordination/packet/render';
import { attachPacket, buildPacket, patchPacket, withPacketBlock, PACKET_BEGIN } from '@/lib/coordination/packet/service';
import type { PacketDeps } from '@/lib/coordination/packet/deps';
import type { RequirementsChecklist } from '@/lib/coordination/contract';
import type { Consent, Contact, Draft } from '@/lib/outreach/types';
import { AI_DISCLOSURE_EMAIL } from '@/lib/safety/disclosure';
import { HISTORY_FIXTURE, OUTSIDE_DOC, SUMMARY_DOC } from '../../fixtures/coordination/packet/history';

const CASE = '11111111-1111-4111-8111-111111111111';
const KEY = 'institution:aaaa1111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-24T00:00:00.000Z';
const source: HistorySource = { name: 'fixture', load: async () => HISTORY_FIXTURE };
const checklist: RequirementsChecklist = {
  caseId: CASE, resourceKey: KEY, name: 'Synthetic Sarcoma Center', checkedUrls: [], unavailableReason: null, version: 1, createdAt: NOW, updatedAt: NOW,
  requirements: [{ id: 'r1', kind: 'referral_letter', label: 'Referral letter from your doctor', detail: 'Required for new patients', sourceUrl: 'https://example.org/referrals', origin: 'fixture', status: 'missing', matchedDocId: null, note: null, updatedAt: NOW }],
};

class FakeOutreach {
  contactRow: Contact = { id: CONTACT_ID, caseId: CASE, targetId: 'aaaa1111', targetKind: 'institution', channel: 'email', address: 'intake@example.org', state: 'drafted' } as Contact;
  consentRow: Consent | undefined = { contactId: CONTACT_ID, sharedFields: ['diseaseName'], approvedAt: NOW };
  draft: Draft | undefined = { id: 'draft-1', contactId: CONTACT_ID, caseId: CASE, channel: 'email', address: 'intake@example.org', body: `Hello,\n\nRequest.\n\n${AI_DISCLOSURE_EMAIL}`, sharedFields: ['diseaseName'], approvedAt: null, sentAt: null };
  async contact() { return this.contactRow; }
  async consent() { return this.consentRow; }
  async pendingDraft() { return this.draft && !this.draft.approvedAt && !this.draft.sentAt ? this.draft : undefined; }
  async updateDraftBody(id: string, _c: string, body: string) { if (!this.draft || this.draft.id !== id || this.draft.approvedAt || this.draft.sentAt) return false; this.draft = { ...this.draft, body }; return true; }
}

let deps: PacketDeps;
let outreach: FakeOutreach;
beforeEach(async () => {
  outreach = new FakeOutreach();
  const store = new MemoryCoordinationStore();
  await store.save(CASE, 'checklist', KEY, checklist);
  deps = {
    store, history: source, outreach: outreach as never, now: () => new Date(NOW),
    inputs: async () => [{ targetKind: 'institution', targetId: 'aaaa1111', name: 'Synthetic Sarcoma Center', contactId: CONTACT_ID, evidence: [{ id: 'e1', claimType: 'specialty', claim: 'Sarcoma and MRI imaging expertise', sourceUrl: 'https://example.org/s', sourceKind: 'exa' }] }],
  };
});

describe('conflict detection', () => {
  it('flags a differing value with an unstated date and differing event dates across documents', () => {
    const texts = detectConflicts(HISTORY_FIXTURE).map(i => i.text);
    expect(texts.some(t => t.includes('hemoglobin') && t.includes('9.8') && t.includes('11.2'))).toBe(true);
    expect(texts.some(t => t.includes('different dates for diagnosis') && t.includes('2023-03-14') && t.includes('2023-03-20'))).toBe(true);
  });
  it('does not flag the same value, values within one document, or a trend on different dates', () => {
    const dated = [
      { id: 'a', title: 'A', text: 'Hemoglobin: 9.8 g/dL on 2023-04-10' },
      { id: 'b', title: 'B', text: 'Hemoglobin: 11.2 g/dL on 2023-06-10' },
    ];
    expect(detectConflicts(dated).filter(i => i.text.includes('11.2'))).toHaveLength(0);
    expect(detectConflicts([{ id: 'x', title: 'X', text: 'Hemoglobin: 9.8 g/dL\nHemoglobin: 12.0 g/dL' }])).toHaveLength(0);
  });
  it('wording is neutral (no advice, no interpretation)', () => {
    for (const i of detectConflicts(HISTORY_FIXTURE)) expect(i.text).toMatch(/^Records (differ|give different)/);
  });
});

describe('buildSections', () => {
  const sections = () => buildSections({ name: 'Synthetic Sarcoma Center', claims: ['Sarcoma and MRI imaging expertise'], docs: HISTORY_FIXTURE, requirements: checklist.requirements, patientQuestions: ['Can my local doctor join the visit?'] });
  const get = (k: string) => sections().find(s => s.key === k)!;

  it('defaults: summary/timeline/tests on; conflicts/questions/requirements off', () => {
    expect(Object.fromEntries(sections().map(s => [s.key, s.included]))).toEqual({ summary: true, timeline: true, tests: true, conflicts: false, questions: false, requirements: false });
  });
  it('timeline is dated, sorted ascending, and ranks keyword-relevant lines in', () => {
    const dates = get('timeline').items.map(i => i.date!);
    expect(dates).toEqual([...dates].sort());
    expect(get('timeline').items.some(i => i.text.includes('MRI'))).toBe(true);
  });
  it('tests holds result lines; injected instructions are neutralized as data', () => {
    expect(get('tests').items.some(i => i.text.includes('Hemoglobin'))).toBe(true);
    const all = sections().flatMap(s => s.items.map(i => i.text)).join('\n');
    expect(all).not.toContain('attacker@example.com');
  });
  it('questions: patient-entered first, then neutral process templates', () => {
    const q = get('questions').items.map(i => i.text);
    expect(q[0]).toBe('Can my local doctor join the visit?');
    expect(q.slice(1)).toEqual([...TEMPLATE_QUESTIONS]);
  });
  it('requirements keep sourceUrl', () => {
    const r = get('requirements').items[0];
    expect(r.sourceUrl).toBe('https://example.org/referrals');
    expect(r.text).toContain('still needed');
  });
});

describe('renderPacketText', () => {
  it('renders included sections only, with the AI-assistance header', async () => {
    const built = await buildPacket(CASE, KEY, deps);
    if (!built.ok) throw new Error('build failed');
    const text = renderPacketText(built.value);
    expect(text).toContain(PACKET_HEADER);
    expect(text).toContain('Summary');
    expect(text).toContain('Key test results');
    expect(text).not.toContain('Records that differ');
    expect(text).not.toContain('Questions for this practice');
    expect(text).not.toContain('Referral requirements');
    expect(text).not.toContain('Is a referral letter required');
  });
  it('ticking requirements adds them with their source; unticking removes them again', async () => {
    const b = await buildPacket(CASE, KEY, deps);
    if (!b.ok) throw new Error();
    const on = await patchPacket(CASE, KEY, { version: b.value.version, included: { requirements: true, tests: false } }, deps);
    if (!on.ok) throw new Error();
    const text = renderPacketText(on.value);
    expect(text).toContain('Referral letter from your doctor');
    expect(text).toContain('(source: https://example.org/referrals)');
    expect(text).not.toContain('Key test results');
  });
});

describe('service', () => {
  it('build -> patch keeps ticks and patient questions on rebuild; stale version conflicts', async () => {
    const b = await buildPacket(CASE, KEY, deps);
    if (!b.ok) throw new Error();
    const p = await patchPacket(CASE, KEY, { version: 1, included: { conflicts: true, summary: false }, questions: ['  Is there a parking pass? '] }, deps);
    expect(p.ok && p.value.version).toBe(2);
    const stale = await patchPacket(CASE, KEY, { version: 1, included: { tests: false } }, deps);
    expect(stale).toMatchObject({ ok: false, status: 409 });
    const rebuilt = await buildPacket(CASE, KEY, deps);
    if (!rebuilt.ok) throw new Error();
    const byKey = Object.fromEntries(rebuilt.value.sections.map(s => [s.key, s]));
    expect(byKey.conflicts.included).toBe(true);
    expect(byKey.summary.included).toBe(false);
    expect(byKey.questions.items[0].text).toBe('Is there a parking pass?');
    expect(rebuilt.value.version).toBe(3);
  });
  it('unknown resource is 404', async () => {
    expect(await buildPacket(CASE, 'expert:zzz', deps)).toMatchObject({ ok: false, status: 404 });
  });
  it('case-docs source reads only the patient own records, de-duplicated, sanitized', async () => {
    const docs = new MemoryDocumentStore();
    const base = { caseId: CASE, contactId: null, sourceUrl: null, sharedField: null, embedding: [0], embedModel: 'm' };
    await docs.insert([
      { ...base, kind: 'case_summary', title: 'Summary', chunkIndex: 0, content: 'Line one' },
      { ...base, kind: 'case_summary', title: 'Summary', chunkIndex: 1, content: 'Line two' },
      { ...base, kind: 'resource_page', title: 'Public page', chunkIndex: 0, content: 'public text' },
      { ...base, kind: 'inbound_message', title: 'Reply', chunkIndex: 0, content: 'third party' },
    ]);
    const out = await caseDocsHistorySource(() => docs).load(CASE);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Line one\nLine two');
  });
});

describe('attach', () => {
  const ready = async () => { const b = await buildPacket(CASE, KEY, deps); if (!b.ok) throw new Error(); return b.value; };

  it('appends included sections before the disclosure footer and returns the draft id', async () => {
    await ready();
    const r = await attachPacket(CASE, KEY, CONTACT_ID, deps);
    expect(r).toEqual({ ok: true, value: { draftId: 'draft-1' } });
    const body = outreach.draft!.body;
    expect(body).toContain(PACKET_BEGIN);
    expect(body.indexOf(PACKET_BEGIN)).toBeLessThan(body.indexOf(AI_DISCLOSURE_EMAIL));
    expect(body).not.toContain('Records that differ');
  });
  it('is idempotent: attaching twice keeps one packet block', async () => {
    await ready();
    await attachPacket(CASE, KEY, CONTACT_ID, deps);
    await attachPacket(CASE, KEY, CONTACT_ID, deps);
    expect(outreach.draft!.body.split(PACKET_BEGIN)).toHaveLength(2);
    expect(withPacketBlock('x', 'y').split(PACKET_BEGIN)).toHaveLength(2);
  });
  it('refuses when the draft is already approved or sent (409), leaving it untouched', async () => {
    await ready();
    outreach.draft = { ...outreach.draft!, approvedAt: NOW };
    const before = outreach.draft.body;
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 409 });
    expect(outreach.draft.body).toBe(before);
    outreach.draft = { ...outreach.draft, approvedAt: null, sentAt: NOW };
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 409 });
  });
  it('refuses with no draft or no consent (409)', async () => {
    await ready();
    outreach.draft = undefined;
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 409 });
    outreach.consentRow = undefined;
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 409 });
  });
  it('refuses a contact from another case (404), another resource (422) or a voice channel (422)', async () => {
    await ready();
    outreach.contactRow = { ...outreach.contactRow, caseId: '99999999-9999-4999-8999-999999999999' };
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 404 });
    outreach.contactRow = { ...outreach.contactRow, caseId: CASE, targetId: 'other' };
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 422 });
    outreach.contactRow = { ...outreach.contactRow, targetId: 'aaaa1111', channel: 'voice' };
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 422 });
  });
  it('refuses when no section with content is ticked (422) and when no packet exists (404)', async () => {
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 404 });
    const p = await ready();
    await patchPacket(CASE, KEY, { version: p.version, included: { summary: false, timeline: false, tests: false } }, deps);
    expect(await attachPacket(CASE, KEY, CONTACT_ID, deps)).toMatchObject({ ok: false, status: 422 });
    expect(outreach.draft!.body).not.toContain(PACKET_BEGIN);
  });
});

void SUMMARY_DOC; void OUTSIDE_DOC;

describe('timeline lines that start with their own date', () => {
  const doc = { id: 'd-1', title: 'Notes', text: 'Clinic notes\n06/15/2021 — Follow-up visit\nAdmission 2023-04-02\n2019-06-12: Initial visit' };
  const timeline = buildSections({ name: 'Center', claims: [], docs: [doc], requirements: [], patientQuestions: [] }).find(s => s.key === 'timeline')!.items;
  it('drop the leading date so the packet does not print it twice', () => {
    expect(timeline.map(i => [i.date, i.text])).toEqual([
      ['2019-06-12', 'Initial visit'],
      ['2021-06-15', 'Follow-up visit'],
      ['2023-04-02', 'Admission 2023-04-02'],
    ]);
  });
});

describe('markdown records', () => {
  const md = {
    id: 'md-1', title: 'Genetic report',
    text: '# Clinical genetics report — Jane Q. Sample\n\nLaboratory: Synthetic Lab\n\n## 2025-02-10 — Panel result\n\n**Classification:** Likely pathogenic\n',
  };
  const sections = buildSections({ name: 'Center', claims: [], docs: [md], requirements: [], patientQuestions: [] });
  const items = (key: string) => sections.find(s => s.key === key)!.items.map(i => i.text);

  it('keeps markdown heading lines (often the patient name) out of the summary', () => {
    expect(items('summary').join('\n')).not.toMatch(/Jane Q\. Sample|#/);
    expect(items('summary')).toContain('Laboratory: Synthetic Lab');
  });

  it('strips markdown markers from timeline and test lines', () => {
    expect(items('timeline')).toEqual(['Panel result']);
    expect(items('tests')).toContain('Classification: Likely pathogenic');
  });
});
