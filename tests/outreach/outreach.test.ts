import { describe, expect, it } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { outreachHandlers } from '../../lib/outreach/http';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { createDraft } from '../../lib/outreach/draft';
import { AI_DISCLOSURE_VOICE } from '../../lib/safety/disclosure';
import { activeContactCount } from '../../lib/safety/caps';
import { OutreachError, type Candidate, type Consent, type Contact, type Draft, type OutreachStore, type ProviderRef } from '../../lib/outreach/types';
const id = () => crypto.randomUUID();
class MemoryStore implements OutreachStore {
  caseId = id();
  record = { diseaseName: 'epithelioid sarcoma', insurer: 'Fictional Plan', planId: 'SECRET-PLAN', homeState: 'CA' };
  choices: Candidate[] = [];
  people: Contact[] = [];
  consents = new Map<string, Consent>();
  drafts = new Map<string, Draft>();
  deliveries: ProviderRef[] = [];
  async getCase(key: string) { return key === this.caseId ? this.record : undefined; }
  async candidates(caseId: string, ids: string[]) { return this.choices.filter(c => c.caseId === caseId && ids.includes(c.id)); }
  async contacts(caseId: string) { return this.people.filter(c => c.caseId === caseId); }
  async contact(key: string) { return this.people.find(c => c.id === key); }
  async select(_caseId: string, contacts: Contact[], cap: number) { if (activeContactCount(this.people) + contacts.length > cap) throw new OutreachError(422, ['contact_cap']); this.people.push(...contacts); return contacts; }
  async consent(key: string) { return this.consents.get(key); }
  async saveConsent(c: Consent) { this.consents.set(c.contactId, c); }
  async saveDraft(d: Draft) { this.drafts.set(d.id, structuredClone(d)); }
  async draft(key: string) { const d = this.drafts.get(key); return d ? structuredClone(d) : undefined; }
  async reserve(draft: Draft, approvedAt: string) {
    const row = this.drafts.get(draft.id)!;
    if (row.approvedAt || [...this.drafts.values()].some(d => d.contactId === draft.contactId && d.approvedAt) || JSON.stringify(this.consents.get(draft.contactId)?.sharedFields) !== JSON.stringify(draft.sharedFields)) return false;
    row.approvedAt = approvedAt;
    return true;
  }
  async delivered(d: Draft, ref: ProviderRef, sentAt: string) { this.drafts.get(d.id)!.sentAt = sentAt; this.people = this.people.map(c => c.id === d.contactId ? { ...c, state: 'sent' } : c); this.deliveries.push(ref); }
  /** Addresses become tool-stamped contact points (as the research pipeline writes them), never free-text claims. */
  candidate(addresses: string[] = ['intake@example.com'], targetKind: Candidate['targetKind'] = 'expert') {
    const evidence = addresses.map(address => address.includes('@')
      ? { claim: address, claimType: 'contact_point.email.new_patient_line', sourceUrl: 'https://example.com/intake', sourceKind: 'exa' }
      : { claim: address, claimType: 'contact_point.voice.nppes_location_phone', sourceUrl: 'https://npiregistry.cms.hhs.gov/provider-view/1234567890', sourceKind: 'nppes' });
    const candidate: Candidate = { id: id(), caseId: this.caseId, targetId: id(), targetKind, evidence: evidence as Candidate['evidence'] };
    this.choices.push(candidate); return candidate;
  }
}
function setup() {
  const store = new MemoryStore();
  const email = new MockChannel('email'); const voice = new MockChannel('voice');
  const env = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@example.com,+14155550123' };
  const service = new OutreachService(store, [email, voice], env, () => new Date('2026-10-23T12:00:00Z'));
  return { store, email, voice, env, service, api: outreachHandlers(service) };
}
const req = (data: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(data) });
async function ready(ctx: ReturnType<typeof setup>, addresses?: string[]) {
  const c = ctx.store.candidate(addresses);
  const selected = await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id] }));
  const contact = (await selected.json()).contacts[0] as Contact;
  await ctx.api.consent(req({ sharedFields: ['diseaseName'] }), contact.id);
  const response = await ctx.api.draft(req({}), contact.id);
  return { contact, draft: await response.json() as Draft };
}
describe('outreach API and safety boundary', () => {
  it('selects evidence-backed email, persists consent and draft, approves exactly once', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    expect(ctx.email.sent).toHaveLength(0);
    expect(draft.body).toContain('Do you see patients with epithelioid sarcoma');
    expect(draft.body).not.toContain('SECRET-PLAN');
    expect(ctx.store.drafts.get(draft.id)?.approvedAt).toBeUndefined();
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(200);
    expect(ctx.email.sent[0].approvedAt).toBeTruthy();
    expect(ctx.store.people[0].state).toBe('sent');
    expect(ctx.store.deliveries).toHaveLength(1);
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(409);
    expect(ctx.email.sent).toHaveLength(1);
  });
  it('falls back to voice and starts the script with disclosure', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx, ['+14155550123']);
    expect(contact.channel).toBe('voice'); expect(draft.body.startsWith(AI_DISCLOSURE_VOICE)).toBe(true);
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(200);
    expect(ctx.voice.sent).toHaveLength(1);
  });
  it('returns none for missing evidence or personal emails', async () => {
    const ctx = setup(); const c = ctx.store.candidate(['dr.smith@example.com']);
    const response = await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id] }));
    const body = await response.json(); expect(body.contacts).toHaveLength(0); expect(body.unavailable[0].channel).toBe('none');
  });
  it('marks a web-form-only resource as reachable by online form, not as having no route', async () => {
    const ctx = setup(); const c = ctx.store.candidate([]);
    c.evidence = [{ claim: 'https://example.com/intake-form', claimType: 'contact_point.web_form.intake_form', sourceUrl: 'https://example.com/program', sourceKind: 'exa' } as Candidate['evidence'][number]];
    const body = await (await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id] }))).json();
    expect(body.contacts).toHaveLength(0);
    expect(body.unavailable[0]).toMatchObject({ channel: 'none', route: 'web_form' });
    expect(body.unavailable[0].reason).toMatch(/online/i);
    const none = ctx.store.candidate([]);
    const noneBody = await (await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [none.id] }))).json();
    expect(noneBody.unavailable[0].route).toBeUndefined();
  });
  it('prefers email when both evidenced channels exist and selection is idempotent', async () => {
    const ctx = setup(); const c = ctx.store.candidate(['+14155550123', 'intake@example.com']);
    for (let i = 0; i < 2; i++) expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id] }))).status).toBe(200);
    expect(ctx.store.people).toHaveLength(1); expect(ctx.store.people[0].channel).toBe('email');
  });
  it('rejects an oversized selection, duplicate IDs, and fields outside the patient allowlist', async () => {
    const ctx = setup();
    expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: Array.from({ length: 6 }, id) }))).status).toBe(400);
    const c = ctx.store.candidate();
    expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id, c.id] }))).status).toBe(400);
    const { contact } = await ready(ctx);
    expect((await ctx.api.consent(req({ sharedFields: ['createdAt'] }), contact.id)).status).toBe(400);
  });
  it('enforces aggregate active-contact cap on selection', async () => {
    const ctx = setup(); const choices = Array.from({ length: 5 }, () => ctx.store.candidate());
    expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: choices.map(c => c.id) }))).status).toBe(200);
    const extra = ctx.store.candidate();
    expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [extra.id] }))).status).toBe(422);
    expect(ctx.store.people).toHaveLength(5);
  });
  it('collects leak, disclosure, allowlist and over-cap refusals with no send or approval', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    ctx.store.drafts.set(draft.id, { ...ctx.store.drafts.get(draft.id)!, body: 'My insurer is Fictional Plan.' });
    ctx.env.OUTBOUND_ALLOWLIST = '';
    ctx.store.people.push(...Array.from({ length: 5 }, () => ({ ...contact, id: id(), targetId: id() })));
    const response = await ctx.api.approve(req({ draftId: draft.id }), contact.id);
    expect(response.status).toBe(422);
    expect((await response.json()).reasons).toEqual(expect.arrayContaining(['not_allowlisted', 'unshared_field', 'missing_disclosure', 'contact_cap']));
    expect(ctx.email.sent).toHaveLength(0); expect(ctx.store.drafts.get(draft.id)!.approvedAt).toBeUndefined();
  });
  it('requires consent for drafting and approval, refuses consent revocation leaks', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    ctx.store.consents.delete(contact.id);
    expect((await ctx.api.draft(req({}), contact.id)).status).toBe(422);
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(422);
    await ctx.api.consent(req({ sharedFields: [] }), contact.id);
    const response = await ctx.api.approve(req({ draftId: draft.id }), contact.id);
    expect((await response.json()).reasons).toContain('unshared_field'); expect(ctx.email.sent).toHaveLength(0);
  });
  it('rejects contact/draft mismatch, unknown IDs, and malformed JSON', async () => {
    const ctx = setup(); const { draft } = await ready(ctx); const other = await ready(ctx);
    expect((await ctx.api.approve(req({ draftId: draft.id }), other.contact.id)).status).toBe(404);
    expect((await ctx.api.draft(req({}), id())).status).toBe(404);
    expect((await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [id()] }))).status).toBe(404);
    expect((await ctx.api.select(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
  });
  it('concurrent approval of different drafts cannot send twice', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx); const other = await ctx.service.draft(contact.id);
    const responses = await Promise.all([draft, other].map(d => ctx.api.approve(req({ draftId: d.id }), contact.id)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect(ctx.email.sent).toHaveLength(1);
  });
  it('25 simultaneous approvals of the same draft send exactly once', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    const responses = await Promise.all(Array.from({ length: 25 }, () => ctx.api.approve(req({ draftId: draft.id }), contact.id)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(24);
    expect(ctx.email.sent).toHaveLength(1);
  });
  it('keeps ambiguous channel failures reserved so retries cannot duplicate a send', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    ctx.email.send = async () => { throw new Error('timeout after provider accepted'); };
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(503);
    expect(ctx.store.drafts.get(draft.id)!.approvedAt).toBeTruthy();
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(409);
  });
  it('templates match trial, advocacy and aid purposes and allow empty consent', () => {
    const ctx = setup(); const contact: Contact = { id: id(), caseId: ctx.store.caseId, targetId: id(), targetKind: 'trial', channel: 'email', address: 'intake@example.com', state: 'drafted' };
    const consent = { contactId: contact.id, sharedFields: [], approvedAt: new Date().toISOString() };
    expect(createDraft(contact, consent, ctx.store.record).body).toContain('eligibility review');
    expect(createDraft({ ...contact, targetKind: 'organization', purpose: 'advocacy' }, consent, ctx.store.record).body).toContain('resources and programs');
    expect(createDraft({ ...contact, targetKind: 'organization', purpose: 'travel_aid' }, consent, ctx.store.record).body).toContain('application process');
    expect(createDraft(contact, consent, ctx.store.record).body).not.toContain('epithelioid sarcoma');
  });
});

describe('draft reuse (contact plan approval writes drafts before the outbox opens)', () => {
  class ReusingStore extends MemoryStore {
    async pendingDraft(contact: Contact, sharedFields: readonly string[]) {
      return [...this.drafts.values()].find(d => d.contactId === contact.id && !d.approvedAt && !d.sentAt
        && JSON.stringify(d.sharedFields) === JSON.stringify(sharedFields));
    }
    async sentDraft(contact: Contact) {
      return [...this.drafts.values()].filter(d => d.contactId === contact.id && d.sentAt).at(-1);
    }
  }
  function reusing() {
    const store = new ReusingStore();
    const email = new MockChannel('email'); const voice = new MockChannel('voice');
    const env = { NODE_ENV: 'test', OUTBOUND_ALLOWLIST: 'intake@example.com,+14155550123' };
    const service = new OutreachService(store, [email, voice], env, () => new Date('2026-10-23T12:00:00Z'));
    return { store, email, voice, env, service, api: outreachHandlers(service) };
  }

  it('returns the pending unapproved draft instead of writing a second one', async () => {
    const ctx = reusing(); const { contact, draft } = await ready(ctx);
    const again = await ctx.service.draft(contact.id);
    expect(again.id).toBe(draft.id);
    expect(ctx.store.drafts.size).toBe(1);
  });

  it('writes a fresh draft when consent changed or the pending one was approved', async () => {
    const ctx = reusing(); const { contact, draft } = await ready(ctx);
    await ctx.service.consent(contact.id, ['diseaseName', 'homeState']);
    const changed = await ctx.service.draft(contact.id);
    expect(changed.id).not.toBe(draft.id);
    expect(changed.sharedFields).toEqual(['diseaseName', 'homeState']);
  });

  it('returns the sent first message once the contact has been written to, instead of a new draft', async () => {
    const ctx = reusing(); const { contact, draft } = await ready(ctx);
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(200);
    const again = await ctx.service.draft(contact.id);
    expect(again.id).toBe(draft.id);
    expect(again.sentAt).toBeTruthy();
    expect(ctx.store.drafts.size).toBe(1);
  });

  it('refuses a new first-message draft for a contact already written to when the store cannot return the sent one', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(200);
    const before = ctx.store.drafts.size;
    expect((await ctx.api.draft(req({}), contact.id)).status).toBe(409);
    expect(ctx.store.drafts.size).toBe(before);
  });

  it('stores without pendingDraft keep the old behaviour', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    expect((await ctx.service.draft(contact.id)).id).not.toBe(draft.id);
  });
});
