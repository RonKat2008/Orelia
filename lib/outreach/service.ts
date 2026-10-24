import { ingest, search } from '../case-docs';
import { activeContactCount, MAX_ACTIVE_CONTACTS } from '../safety/caps';
import { checkOutbound } from '../safety/outbound-gate';
import { parseAllowlist } from '../safety/allowlist';
import { parseContactPoints } from '../contact-finder/contact-points';
import { createDraft } from './draft';
import { demoCoordinatorInboxes, pickDemoCoordinator } from './demo-coordinators';
import { normalizeAddress } from '../safety/allowlist';
import { isWebFormOnly, type ReachabilityEvidence } from './reachability';
import { OutreachError, type Candidate, type Channel, type Contact, type OutreachStore, type ProviderRef } from './types';
/**
 * The only addresses outreach may use are contact points stamped by code from tool output (intake-door
 * classification, NPPES location phone, CT.gov central contact), each with its source URL. Free-text claims are
 * never searched for addresses: a model-written claim containing an email or phone is not a contact (HARD RULE 2).
 */
function address(candidate: Candidate): { channel: 'email' | 'voice'; address: string; sourceUrl: string } | undefined {
  const points = parseContactPoints(candidate.evidence);
  const pick = points.find(p => p.channel === 'email') ?? points.find(p => p.channel === 'voice');
  return pick && { channel: pick.channel, address: pick.address, sourceUrl: pick.sourceUrl };
}
export class OutreachService {
  constructor(readonly store: OutreachStore, readonly channels: Channel[], readonly env: Record<string, string | undefined> = process.env, readonly clock = () => new Date()) {}
  async select(caseId: string, ids: string[]) {
    if (!await this.store.getCase(caseId)) throw new OutreachError(404, ['case_not_found']);
    const candidates = await this.store.candidates(caseId, ids);
    if (candidates.length !== ids.length) throw new OutreachError(404, ['candidate_not_found']);
    const existing = await this.store.contacts(caseId);
    const fresh = candidates.filter((c, index) => !existing.some(e => e.targetId === c.targetId && e.targetKind === c.targetKind) && candidates.findIndex(other => other.targetId === c.targetId && other.targetKind === c.targetKind) === index);
    const unavailable: { candidateId: string; channel: 'none'; reason: string; route?: 'web_form' }[] = [];
    // Demo coordinator mode (demo only, see demo-coordinators.ts): every new contact goes to one of our own
    // allowlisted AgentMail test inboxes instead of the resource's real contact point.
    const demoInboxes = demoCoordinatorInboxes(this.env);
    const norm = (a: string) => normalizeAddress(a) ?? a.trim().toLowerCase();
    const usedAddresses = new Set(existing.map(e => norm(e.address)));
    const proposed = fresh.flatMap(c => {
      if (demoInboxes.length > 0) {
        const demo = pickDemoCoordinator(`${c.targetKind}:${c.targetId}`, demoInboxes, usedAddresses);
        if (!demo) {
          unavailable.push({ candidateId: c.id, channel: 'none', reason: 'Demo mode: every demo coordinator inbox is already used by another contact on this case, and Wayfinder never writes to one address twice.' });
          return [];
        }
        usedAddresses.add(demo);
        return [{ id: crypto.randomUUID(), caseId, targetId: c.targetId, targetKind: c.targetKind, purpose: c.purpose, channel: 'email' as const, address: demo, state: 'drafted' } satisfies Contact];
      }
      const door = address(c);
      if (!door && isWebFormOnly(c.evidence as ReachabilityEvidence[])) {
        // Reachable only through an online intake/application form (Kernel web-application channel), which has no email/phone contact row.
        unavailable.push({ candidateId: c.id, channel: 'none', route: 'web_form', reason: 'Its only route is an online intake form. That is handled as an online application in the plan step, not sent as email or a call.' });
        return [];
      }
      if (!door) { unavailable.push({ candidateId: c.id, channel: 'none', reason: 'No tool-sourced intake email or phone is available.' }); return []; }
      return [{ id: crypto.randomUUID(), caseId, targetId: c.targetId, targetKind: c.targetKind, purpose: c.purpose, channel: door.channel, address: door.address, state: 'drafted' } satisfies Contact];
    });
    if (activeContactCount(existing) + proposed.length > MAX_ACTIVE_CONTACTS) throw new OutreachError(422, ['contact_cap']);
    const created = await this.store.select(caseId, proposed, MAX_ACTIVE_CONTACTS);
    // Own-target evidence is stored under the contact so drafts never draw on other resources' docs.
    // Best effort: contacts already exist, so a failed embed must not fail selection (drafts then just get less context).
    const stored = await Promise.allSettled(created.flatMap(contact => fresh.filter(c => c.targetId === contact.targetId && c.targetKind === contact.targetKind)
      .flatMap(c => c.evidence.map(e => ingest({ caseId, contactId: contact.id, kind: 'evidence', title: e.claimType, sourceUrl: e.sourceUrl, text: e.claim })))));
    if (stored.some(r => r.status === 'rejected')) console.error('Contact evidence ingest failed for some docs; drafts get less public context');
    // The store never creates two contacts for one address on a case. A resource whose only address is already
    // used by another contact gets no contact of its own: report it instead of letting it vanish.
    for (const c of fresh) {
      const mine = proposed.find(p => p.targetId === c.targetId && p.targetKind === c.targetKind);
      if (mine && !created.some(x => x.targetId === c.targetId && x.targetKind === c.targetKind)) {
        unavailable.push({ candidateId: c.id, channel: 'none', reason: 'Its only address is already used by another contact on this case, and Wayfinder never writes to one address twice.' });
      }
    }
    const own = (x: Contact) => candidates.some(c => x.targetId === c.targetId && x.targetKind === c.targetKind);
    const contacts = [...existing.filter(own), ...created.filter(own)].filter((x, i, all) => all.findIndex(y => y.id === x.id) === i);
    return { contacts, unavailable };
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
    const pending = await this.store.pendingDraft?.(contact, consent.sharedFields);
    if (pending) return pending;
    const docs = await search({ caseId: contact.caseId, contactId: contact.id, allowedFields: [], contactOnly: true, query: 'intake requirements hours referral process', k: 5 });
    const draft = createDraft(contact, consent, record, docs);
    await this.store.saveDraft(draft);
    return draft;
  }
  async approve(id: string, draftId: string): Promise<ApproveResult> {
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

export type SentApproveResult = { draftId: string; approvedAt: string; sentAt: string; provider: ProviderRef };
export type ApproveResult = SentApproveResult | { draftId: string; approvedAt: string; queued: true; sentAt?: never; provider?: never };
