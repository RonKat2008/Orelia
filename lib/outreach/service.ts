import { activeContactCount, MAX_ACTIVE_CONTACTS } from '../safety/caps';
import { checkOutbound } from '../safety/outbound-gate';
import { parseAllowlist, normalizeAddress } from '../safety/allowlist';
import { isRoleEmail } from '../contact-finder';
import { createDraft } from './draft';
import { OutreachError, type Candidate, type Channel, type Contact, type OutreachStore } from './types';
function address(candidate: Candidate): { channel: 'email' | 'voice'; address: string } | undefined {
  const claims = candidate.evidence.filter(e => {
    try { return ['https:', 'http:'].includes(new URL(e.sourceUrl).protocol) && /contact|intake|referral|appointment|navigator/i.test(e.claimType + ' ' + e.claim); } catch { return false; }
  }).map(e => e.claim);
  const emails = claims.flatMap(text => text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? []).filter(isRoleEmail);
  if (emails.length) return { channel: 'email', address: normalizeAddress(emails[0])! };
  const phones = claims.flatMap(text => text.match(/\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4}\b/g) ?? []).map(normalizeAddress).filter((s): s is string => !!s && s.startsWith('+'));
  if (phones.length) return { channel: 'voice', address: phones[0] };
}
export class OutreachService {
  constructor(readonly store: OutreachStore, readonly channels: Channel[], readonly env: Record<string, string | undefined> = process.env, readonly clock = () => new Date()) {}
  async select(caseId: string, ids: string[]) {
    if (!await this.store.getCase(caseId)) throw new OutreachError(404, ['case_not_found']);
    const candidates = await this.store.candidates(caseId, ids);
    if (candidates.length !== ids.length) throw new OutreachError(404, ['candidate_not_found']);
    const existing = await this.store.contacts(caseId);
    const fresh = candidates.filter((c, index) => !existing.some(e => e.targetId === c.targetId && e.targetKind === c.targetKind) && candidates.findIndex(other => other.targetId === c.targetId && other.targetKind === c.targetKind) === index);
    const unavailable: { candidateId: string; channel: 'none'; reason: string }[] = [];
    const proposed = fresh.flatMap(c => {
      const door = address(c);
      if (!door) { unavailable.push({ candidateId: c.id, channel: 'none', reason: 'No evidenced intake email or phone is available.' }); return []; }
      return [{ id: crypto.randomUUID(), caseId, targetId: c.targetId, targetKind: c.targetKind, purpose: c.purpose, ...door, state: 'drafted' } satisfies Contact];
    });
    if (activeContactCount(existing) + proposed.length > MAX_ACTIVE_CONTACTS) throw new OutreachError(422, ['contact_cap']);
    const created = await this.store.select(caseId, proposed, MAX_ACTIVE_CONTACTS);
    return { contacts: [...existing.filter(e => candidates.some(c => e.targetId === c.targetId && e.targetKind === c.targetKind)), ...created], unavailable };
  }
  async requireContact(id: string) { const c = await this.store.contact(id); if (!c) throw new OutreachError(404, ['contact_not_found']); return c; }
  async consent(id: string, sharedFields: string[]) {
    await this.requireContact(id);
    const consent = { contactId: id, sharedFields, approvedAt: this.clock().toISOString() };
    await this.store.saveConsent(consent);
    return consent;
  }
  async draft(id: string) {
    const contact = await this.requireContact(id);
    const consent = await this.store.consent(id);
    if (!consent?.approvedAt) throw new OutreachError(422, ['consent_required']);
    const record = await this.store.getCase(contact.caseId);
    if (!record) throw new OutreachError(404, ['case_not_found']);
    const draft = createDraft(contact, consent, record);
    await this.store.saveDraft(draft);
    return draft;
  }
  async approve(id: string, draftId: string) {
    const contact = await this.requireContact(id);
    const draft = await this.store.draft(draftId, contact);
    if (!draft || draft.contactId !== id) throw new OutreachError(404, ['draft_not_found']);
    if (draft.sentAt || draft.approvedAt) throw new OutreachError(409, ['already_approved']);
    const consent = await this.store.consent(id);
    if (!consent?.approvedAt) throw new OutreachError(422, ['consent_required']);
    const record = await this.store.getCase(contact.caseId);
    if (!record) throw new OutreachError(404, ['case_not_found']);
    const now = this.clock().toISOString();
    const contacts = await this.store.contacts(contact.caseId);
    const gate = checkOutbound({ draft: { ...draft, approvedAt: now }, caseRecord: record, consent, contacts, allowlist: parseAllowlist(this.env.OUTBOUND_ALLOWLIST ?? ''), now, mode: this.env.NODE_ENV === 'production' ? 'prod' : 'dev' });
    const reasons = gate.ok ? [] : [...gate.reasons];
    if (activeContactCount(contacts) > MAX_ACTIVE_CONTACTS && !reasons.includes('contact_cap')) reasons.push('contact_cap');
    if (reasons.length || !gate.ok) throw new OutreachError(422, reasons);
    const channel = this.channels.find(c => c.kind === contact.channel);
    if (!channel) throw new OutreachError(503, ['channel_unavailable']);
    if (!await this.store.reserve(draft, now)) throw new OutreachError(409, ['already_approved_or_consent_changed']);
    const ref = await channel.send(gate.payload);
    await this.store.delivered(draft, ref, now);
    return { draftId, approvedAt: now, sentAt: now, provider: ref };
  }
}
