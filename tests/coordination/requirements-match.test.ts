import { describe, expect, it } from 'vitest';
import { matchRequirement } from '@/lib/coordination/requirements/match';

const doc = (id: string, title: string, kind = 'patient_note') => ({ id, title, kind });
const req = (kind: string, label: string, detail = '') => ({ kind: kind as never, label, detail });

describe('matchRequirement', () => {
  it('records: have when a patient document title matches the record type', () => {
    expect(matchRequirement(req('records', 'Records: imaging'), [doc('d1', 'MRI imaging report 2026')])).toEqual({ status: 'have', matchedDocId: 'd1' });
  });
  it('records: missing when nothing matches', () => {
    expect(matchRequirement(req('records', 'Records: pathology'), [doc('d1', 'Insurance card')])).toEqual({ status: 'missing', matchedDocId: null });
  });
  it('ignores public documents (resource pages, evidence)', () => {
    expect(matchRequirement(req('records', 'Records: imaging'), [doc('d1', 'Imaging at center', 'resource_page')]).status).toBe('missing');
  });
  it('generic records: a case summary counts', () => {
    expect(matchRequirement(req('records', 'Medical records'), [doc('s1', 'Case summary', 'case_summary')])).toEqual({ status: 'have', matchedDocId: 's1' });
  });
  it('referral letter and pre-auth are have only with a matching title', () => {
    expect(matchRequirement(req('referral_letter', 'Referral letter'), [doc('r1', 'Referral letter from Dr. Synthetic')]).status).toBe('have');
    expect(matchRequirement(req('referral_letter', 'Referral letter'), [doc('r1', 'Lab results')]).status).toBe('missing');
    expect(matchRequirement(req('insurance_preauth', 'Insurance pre-authorization'), [doc('i1', 'Prior authorization approval')]).status).toBe('have');
  });
  it('e-consult and other are unknown', () => {
    expect(matchRequirement(req('econsult', 'E-consult'), [doc('a', 'x')]).status).toBe('unknown');
    expect(matchRequirement(req('other', 'Other'), []).status).toBe('unknown');
  });
});
