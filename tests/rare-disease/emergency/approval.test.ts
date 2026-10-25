import { describe, expect, it } from 'vitest';
import {
  approvalState, approveRecord, approvedSnapshot, emptyRecord, withInputs, withShare,
} from '@/lib/rare-disease/emergency/approval';
import { cardInputsSchema } from '@/lib/rare-disease/emergency/contract';
import { buildCard } from '@/lib/rare-disease/emergency/filter';
import { contentHash } from '@/lib/rare-disease/emergency/hash';
import { CASE_A, documents, events, inputs, needs } from './fixtures';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const card = (i = inputs, n = needs) => buildCard({ caseId: CASE_A, undiagnosed: false, needs: n, events, documents, inputs: i }).content;

function approved() {
  const record = withInputs(emptyRecord(NOW), inputs, NOW);
  const c = card();
  const hash = contentHash(c);
  const r = approveRecord(record, c, { version: record.version, contentHash: hash }, NOW);
  if (!r.ok) throw new Error(r.error);
  return { record: r.record, hash };
}

describe('contentHash', () => {
  it('is stable and changes with the content', () => {
    expect(contentHash(card())).toBe(contentHash(card()));
    const other = card({ ...inputs, contacts: [{ name: 'Sam Lee', relationship: 'Sister', phone: '555-010-9999' }] });
    expect(contentHash(other)).not.toBe(contentHash(card()));
  });
});

describe('approval gating', () => {
  it('an unapproved card has no snapshot', () => {
    const record = withInputs(emptyRecord(NOW), inputs, NOW);
    expect(approvalState(record, contentHash(card()))).toBe('needs_approval');
    expect(approvedSnapshot(record, contentHash(card()))).toBeNull();
  });

  it('approval records approvedAt, the hash and the version, and yields a snapshot', () => {
    const { record, hash } = approved();
    expect(record.approval).toEqual({ approvedAt: NOW.toISOString(), contentHash: hash, version: record.version });
    expect(approvalState(record, hash)).toBe('approved');
    expect(approvedSnapshot(record, hash)?.content).toEqual(card());
  });

  it('refuses a stale version or a hash the patient did not see', () => {
    const record = withInputs(emptyRecord(NOW), inputs, NOW);
    const c = card();
    expect(approveRecord(record, c, { version: record.version + 1, contentHash: contentHash(c) }, NOW)).toEqual({ ok: false, error: 'stale' });
    expect(approveRecord(record, c, { version: record.version, contentHash: 'abc' }, NOW)).toEqual({ ok: false, error: 'stale' });
  });

  it('refuses an empty card', () => {
    const record = emptyRecord(NOW);
    const c = buildCard({ caseId: CASE_A, undiagnosed: false, needs: null, events: [], documents: [], inputs: record.inputs }).content;
    expect(approveRecord(record, c, { version: record.version, contentHash: contentHash(c) }, NOW)).toEqual({ ok: false, error: 'empty' });
  });

  it('editing the contacts clears approval, bumps the version and revokes the share', () => {
    const { record } = approved();
    const shared = withShare(record, { id: 's1', createdAt: NOW.toISOString(), expiresAt: '2026-11-01T00:00:00.000Z', revokedAt: null });
    const edited = withInputs(shared, { ...inputs, contacts: [] }, NOW);
    expect(edited.approval).toBeNull();
    expect(edited.snapshot).toBeNull();
    expect(edited.version).toBe(record.version + 1);
    expect(edited.share?.revokedAt).toBe(NOW.toISOString());
    expect(shared.approval).not.toBeNull();
  });

  it('saving the same inputs again keeps the approval', () => {
    const { record } = approved();
    expect(withInputs(record, structuredClone(inputs), NOW)).toEqual(record);
  });

  it('new sourced facts clear the approval (content hash no longer matches)', () => {
    const { record } = approved();
    const more = { ...needs, emergencyFacts: [...needs.emergencyFacts, { id: 'emer-9', text: 'Sources describe fragile skin.', evidenceIds: ['pubmed:111'] }] };
    const newHash = contentHash(card(inputs, more));
    expect(approvalState(record, newHash)).toBe('changed');
    expect(approvedSnapshot(record, newHash)).toBeNull();
  });
});

describe('cardInputsSchema', () => {
  it('accepts plain names and phone numbers', () => {
    expect(cardInputsSchema.safeParse(inputs).success).toBe(true);
  });
  it.each([
    { contacts: [{ name: '<script>', relationship: 'x', phone: '555-010-2000' }], careTeam: [] },
    { contacts: [{ name: 'A'.repeat(81), relationship: 'x', phone: '555-010-2000' }], careTeam: [] },
    { contacts: [{ name: 'Ann', relationship: 'x', phone: 'call me' }], careTeam: [] },
    { contacts: [{ name: 'Ann', relationship: 'x', phone: '12' }], careTeam: [] },
    { contacts: Array.from({ length: 5 }, () => ({ name: 'Ann', relationship: 'x', phone: '555-010-2000' })), careTeam: [] },
    { contacts: [], careTeam: [], extra: true },
  ])('rejects bad input %#', (bad) => expect(cardInputsSchema.safeParse(bad).success).toBe(false));
});
