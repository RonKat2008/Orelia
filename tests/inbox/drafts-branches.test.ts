import { describe, expect, it } from 'vitest';
import { draftTasks, MedicalAdviceInDraft, type DraftContext } from '../../lib/inbox/drafts';
import type { InboxClassification } from '../../lib/inbox/schema';

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  contactId: 'c1', caseId: 'case1', resourceName: 'Example Clinic', consent: { sharedFields: ['insurer', 'planId'] },
  caseRecord: { insurer: 'Fictional Plan', planId: 'PLAN-123', diseaseName: 'synthetic disease' } as never,
  currentPhysician: { name: 'Dr. Lee', email: 'dr@example.com' }, ...over,
});
const cls = (c: Partial<InboxClassification> & Pick<InboxClassification, 'class'>): InboxClassification => ({ confidence: 0.9, rationale: 'a reason', ...c });
const one = (c: InboxClassification, over: Partial<DraftContext> = {}) => draftTasks(c, ctx(over))[0]!;

describe('draftTasks branches', () => {
  it('call_to_schedule without phone says no number was stated and omits hours and ready lines', () => {
    const d = one(cls({ class: 'call_to_schedule' }));
    expect(d.draftBody).toBe('Call Example Clinic (no number was stated in their reply)');
    expect(d.details).toMatchObject({ phone: undefined, hours: undefined, haveReady: [] });
  });
  it('call_to_schedule with every field lists them on separate lines', () => {
    const d = one(cls({ class: 'call_to_schedule', phone: '+14155550123', hours: '9-5', haveReady: ['card', 'MRN'] }));
    expect(d.draftBody).toBe('Call Example Clinic at +14155550123\nHours: 9-5\nHave ready: card, MRN');
  });
  it('redirect falls back through name, department, then a generic label', () => {
    expect(one(cls({ class: 'redirect', redirect: { name: 'Pat', email: 'p@example.com' } })).title).toBe('Contact Pat instead');
    expect(one(cls({ class: 'redirect', redirect: { department: 'Intake', email: 'i@example.com' } })).title).toBe('Contact Intake instead');
  });
  it('a redirect with no email never produces a letter: a grounded phone becomes a call task, otherwise a look-up task', () => {
    const withPhone = one(cls({ class: 'redirect', redirect: { name: 'Alicia Brandt', phone: '202-555-0189' } }));
    expect(withPhone).toMatchObject({ kind: 'call', title: 'Call Alicia Brandt at 202-555-0189', details: { phone: '202-555-0189' } });
    expect(withPhone.letter).toBeUndefined();
    expect(withPhone.draftBody).toContain('202-555-0189');
    const noPhone = one(cls({ class: 'redirect', redirect: { department: 'Intake' } }));
    expect(noPhone).toMatchObject({ kind: 'call', title: 'Look up a phone number for Intake', details: { lookupNumber: true } });
    expect(noPhone.letter).toBeUndefined();
    expect(noPhone.draftBody).toMatch(/look up the number/i);
    expect(noPhone.draftBody).not.toMatch(/\d{3}[-. ]\d{4}/);
    const bare = one(cls({ class: 'redirect' }));
    expect(bare.title).toBe('Look up a phone number for the suggested contact');
  });
  it('declined suggests the next option, the redirect contact, or admits there is none', () => {
    expect(one(cls({ class: 'declined' }), { nextRankedOption: { id: 'n1', name: 'Other Center' } }).draftBody).toContain('Next option on your list: Other Center');
    expect(one(cls({ class: 'declined', redirect: { name: 'X' } })).draftBody).toContain('try the contact they suggested');
    expect(one(cls({ class: 'declined' })).draftBody).toContain('no other option on your list yet');
    expect(one(cls({ class: 'declined' }), { nextRankedOption: { id: 'n1', name: 'O' } }).details).toMatchObject({ closeContact: true, nextRankedOptionId: 'n1' });
  });
  it('slides without lab details or a lab contact still drafts, with no accession line', () => {
    const d = one(cls({ class: 'send_slides' }), { pathologyLab: undefined });
    expect(d.letter!.to).toBeUndefined();
    expect(d.letter!.body).not.toContain('Accession number');
    expect(d.details).toMatchObject({ accession: undefined, lab: undefined });
  });
  it('includes the resource address in the request when known', () => {
    expect(one(cls({ class: 'needs_referral' }), { resourceAddress: '1 Main St' }).letter!.body).toContain('Example Clinic (1 Main St)');
  });
  it('appends records "have ready" items to the checklist', () => {
    expect(one(cls({ class: 'send_records', haveReady: ['Insurance card'] })).details).toMatchObject({ checklist: expect.arrayContaining(['Insurance card']) });
  });
  it('carries messageId and context doc ids into details only when present', () => {
    expect(one(cls({ class: 'unclear' })).details).not.toHaveProperty('messageId');
    const d = one(cls({ class: 'unclear' }), { messageId: 'm1', contextDocIds: ['d1'] });
    expect(d.details).toMatchObject({ messageId: 'm1', contextDocIds: ['d1'] });
    expect(d.contextDocIds).toEqual(['d1']);
  });
});

describe('coordinator question answers', () => {
  const q = { coordinatorQuestion: 'What insurance do you have?' };
  it('answers insurer and plan id only from consented fields', () => {
    const body = one(cls({ class: 'unclear' }), q).draftBody!;
    expect(body).toContain('Coordinator Q&A:');
    expect(body).toContain('insurer: Fictional Plan');
    expect(body).toContain('plan id: PLAN-123');
  });
  it('does not reveal an unconsented plan id', () => {
    const body = one(cls({ class: 'unclear' }), { ...q, consent: { sharedFields: ['insurer'] } }).draftBody!;
    expect(body).toContain('Fictional Plan');
    expect(body).not.toContain('PLAN-123');
  });
  it('defers to the patient when nothing relevant is consented', () => {
    expect(one(cls({ class: 'unclear' }), { ...q, consent: { sharedFields: [] } }).draftBody).toContain("I'll have the patient follow up");
  });
  it('ignores non-insurance questions and a missing question', () => {
    expect(one(cls({ class: 'unclear' }), { coordinatorQuestion: 'What time works?' }).draftBody).not.toContain('Coordinator Q&A');
    expect(one(cls({ class: 'unclear' })).draftBody).not.toContain('Coordinator Q&A');
  });
  it('stringifies non-string consented values as JSON', () => {
    const body = one(cls({ class: 'unclear' }), { ...q, caseRecord: { insurer: ['A', 'B'] } as never }).draftBody!;
    expect(body).toContain('insurer: ["A","B"]');
  });
});

describe('medical advice screen', () => {
  it('refuses a draft whose generated rationale contains medical advice', () => {
    expect(() => draftTasks(cls({ class: 'unclear', rationale: 'You should stop taking your medication and increase the dose.' }), ctx())).toThrow(MedicalAdviceInDraft);
  });
  it('does not screen the sender\'s verbatim quote (it is not our text)', () => {
    expect(() => draftTasks(cls({ class: 'unclear', quote: 'You should stop taking your medication' }), ctx())).not.toThrow();
  });
});
