import { describe, expect, it } from 'vitest';
import { OutreachService } from '../../lib/outreach/service';
import { outreachHandlers } from '../../lib/outreach/http';
import { MockChannel } from '../../lib/outreach/mock-channel';
import { activeContactCount } from '../../lib/safety/caps';
import { ChannelError } from '../../lib/channels/types';
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
  async unreserve(d: Draft) { const row = this.drafts.get(d.id); if (row && !row.sentAt) row.approvedAt = null; }
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

describe('stress: consent and approve edge cases', () => {
  it('consent with every field unticked: draft shares nothing and approve is safe', async () => {
    const ctx = setup(); const c = ctx.store.candidate();
    const contact = (await (await ctx.api.select(req({ caseId: ctx.store.caseId, candidateIds: [c.id] }))).json()).contacts[0] as Contact;
    expect((await ctx.api.consent(req({ sharedFields: [] }), contact.id)).status).toBe(200);
    const draft = await (await ctx.api.draft(req({}), contact.id)).json() as Draft;
    expect(draft.body).not.toContain('epithelioid');
  });
  it('a body edited to include an unticked field is refused at approve (422) and nothing is sent', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    Object.assign(ctx.store.drafts.get(draft.id)!, { body: ctx.store.drafts.get(draft.id)!.body + '\nHer plan id is SECRET-PLAN and she lives in CA.' });
    const res = await ctx.api.approve(req({ draftId: draft.id }), contact.id);
    expect(res.status).toBe(422); expect(ctx.email.sent).toHaveLength(0);
  });
  it('a body edited to include medical advice is refused', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    Object.assign(ctx.store.drafts.get(draft.id)!, { body: ctx.store.drafts.get(draft.id)!.body + '\nYou should stop taking your medication and start 50mg of prednisone daily.' });
    const res = await ctx.api.approve(req({ draftId: draft.id }), contact.id);
    expect(res.status).toBe(422); expect(ctx.email.sent).toHaveLength(0);
  });
  it('five concurrent approves send exactly once', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    const rs = await Promise.all(Array.from({ length: 5 }, () => ctx.api.approve(req({ draftId: draft.id }), contact.id)));
    expect(rs.filter(r => r.status === 200)).toHaveLength(1); expect(ctx.email.sent).toHaveLength(1);
  });
  it('a definite provider rejection (HTTP 403, nothing sent) does not leave the draft permanently approved', async () => {
    const ctx = setup(); const { contact, draft } = await ready(ctx);
    ctx.email.send = async () => { throw new ChannelError('agentmail', 'inbox limit', 403, false); };
    const rejected = await ctx.api.approve(req({ draftId: draft.id }), contact.id);
    expect(rejected.status).toBe(502); expect((await rejected.json()).reasons).toEqual(['send_rejected']);
    ctx.email.send = async () => ({ messageId: 'm1', threadId: 't1' });
    expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(200);
  });
  it('an ambiguous failure (HTTP 500 or a network error) stays reserved so a retry cannot double-send', async () => {
    for (const err of [new ChannelError('agentmail', 'boom', 500, true), new ChannelError('agentmail', 'timeout', undefined, true)]) {
      const ctx = setup(); const { contact, draft } = await ready(ctx);
      ctx.email.send = async () => { throw err; };
      expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(502);
      ctx.email.send = async () => ({ messageId: 'm1', threadId: 't1' });
      expect((await ctx.api.approve(req({ draftId: draft.id }), contact.id)).status).toBe(409);
    }
  });
});
