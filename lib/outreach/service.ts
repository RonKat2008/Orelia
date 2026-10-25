import { isDefiniteNonDelivery } from '../channels/types';
import { ingest, search } from '../case-docs';
import { activeContactCount, MAX_ACTIVE_CONTACTS } from '../safety/caps';
import { checkOutbound } from '../safety/outbound-gate';
import { parseContactPoints } from '../contact-finder/contact-points';
import { createDraft } from './draft';
import { demoDestinationFor, outboundAllowlist, sharedDemoAddresses } from './demo-destinations';
import { contactRoutesOf, isWebFormOnly, type ReachabilityEvidence } from './reachability';
import { isReplyClassification, OutreachError, type Candidate, type Channel, type Contact, type Draft, type OutreachStore, type ProviderRef } from './types';
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
    // Demo mode (demo only, see demo-destinations.ts): the channel is chosen from the resource's REAL contact points
    // exactly as without demo mode; only the destination is swapped for our own test inbox / test phone / sink.
    const shared = sharedDemoAddresses(this.env);
    const proposed = fresh.flatMap((c): Contact[] => {
      const door = address(c);
      if (!door && isWebFormOnly(c.evidence as ReachabilityEvidence[])) {
        // Reachable only through an online intake/application form: a 'web' contact (address = the tool-sourced form
        // URL) carries the patient's consent, and the plan step fills the form as an application. It never gets an
        // email or call draft, and the filled form is submitted only after the patient approves it (approved_at).
        const form = contactRoutesOf(c.evidence as ReachabilityEvidence[]).find(r => r.channel === 'web_form');
        if (!form) return [];
        return [{ id: crypto.randomUUID(), caseId, targetId: c.targetId, targetKind: c.targetKind, purpose: c.purpose, channel: 'web' as const, address: form.address, state: 'drafted' } satisfies Contact];
      }
      if (!door) { unavailable.push({ candidateId: c.id, channel: 'none', reason: 'No tool-sourced intake email or phone is available.' }); return []; }
      const demo = demoDestinationFor(this.env, door.channel, `${c.targetKind}:${c.targetId}`);
      if (shared.length > 0 && !demo) { unavailable.push({ candidateId: c.id, channel: 'none', reason: 'Demo mode has no test destination configured for this channel.' }); return []; }
      return [{ id: crypto.randomUUID(), caseId, targetId: c.targetId, targetKind: c.targetKind, purpose: c.purpose, channel: door.channel, address: demo ?? door.address, state: 'drafted' } satisfies Contact];
    });
    if (activeContactCount(existing) + proposed.length > MAX_ACTIVE_CONTACTS) throw new OutreachError(422, ['contact_cap']);
    const created = await this.store.select(caseId, proposed, MAX_ACTIVE_CONTACTS, shared.length > 0 ? { sharedAddresses: shared } : undefined);
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
        unavailable.push({ candidateId: c.id, channel: 'none', reason: 'Its only address is already used by another contact on this case, and Orelia never writes to one address twice.' });
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
    if (contact.state !== 'drafted') {
      // They asked for records or slides and the patient approved writing the reply: that letter is what needs approval now.
      const reply = await this.store.pendingReply?.(contact);
      if (reply) return reply;
      // Waiting for a reply and the sweep drafted a follow-up: that is what needs the patient's approval now.
      if (contact.state === 'sent') {
        const followUp = await this.store.pendingFollowUp?.(contact);
        if (followUp) return followUp;
      }
      // Already written to: show the message that went out; never mint a second first-message draft.
      const sent = await this.store.sentDraft?.(contact);
      if (sent) return sent;
      throw new OutreachError(409, ['already_contacted']);
    }
    const pending = await this.store.pendingDraft?.(contact, consent.sharedFields);
    if (pending) return pending;
    const docs = await search({ caseId: contact.caseId, contactId: contact.id, allowedFields: [], contactOnly: true, query: 'intake requirements hours referral process', k: 5 });
    const draft = createDraft(contact, consent, record, docs);
    await this.store.saveDraft(draft);
    return draft;
  }
  /**
   * `opts.voiceChannel` (DEMO ONLY, see browser-call.ts) sends an approved first call through a different voice
   * transport (the presenter's browser). Everything before the send is identical: consent, checkOutbound, cap, reserve.
   */
  async approve(id: string, draftId: string, opts: ApproveOptions = {}): Promise<ApproveResult> {
    const contact = await this.requireContact(id);
    const draft = await this.store.draft(draftId, contact);
    if (!draft || draft.contactId !== id) throw new OutreachError(404, ['draft_not_found']);
    if (draft.sentAt || draft.approvedAt) throw new OutreachError(409, ['already_approved']);
    const consent = await this.store.consent(id);
    if (!consent?.approvedAt) throw new OutreachError(422, ['consent_required']);
    const record = await this.store.getCase(contact.caseId);
    if (!record) throw new OutreachError(404, ['case_not_found']);
    const now = this.clock().toISOString();
    if (isReplyClassification(draft.classification)) {
      if (opts.voiceChannel) throw new OutreachError(409, ['first_call_only']);
      return this.approveReply(contact, draft, consent, record, now);
    }
    const contacts = await this.store.contacts(contact.caseId);
    const gate = checkOutbound({ draft: { ...draft, approvedAt: now }, caseRecord: record, consent, contacts, allowlist: outboundAllowlist(this.env), now, mode: this.env.NODE_ENV === 'production' ? 'prod' : 'dev' });
    const reasons = gate.ok ? [] : [...gate.reasons];
    if (activeContactCount(contacts) > MAX_ACTIVE_CONTACTS && !reasons.includes('contact_cap')) reasons.push('contact_cap');
    if (reasons.length || !gate.ok) throw new OutreachError(422, reasons);
    if (opts.voiceChannel && contact.channel !== 'voice') throw new OutreachError(422, ['not_a_call']);
    const channel = opts.voiceChannel ?? this.channels.find(c => c.kind === contact.channel);
    if (!channel) throw new OutreachError(503, ['channel_unavailable']);
    if (!await this.store.reserve(draft, now)) throw new OutreachError(409, ['already_approved_or_consent_changed']);
    let ref: ProviderRef;
    try { ref = await channel.send(gate.payload); } catch (error) {
      // A provider 4xx means nothing was sent: undo the reservation so the patient can retry. Anything ambiguous stays reserved.
      if (isDefiniteNonDelivery(error)) await this.store.unreserve?.(draft);
      throw error;
    }
    await this.store.delivered(draft, ref, now);
    return { draftId, approvedAt: now, sentAt: now, provider: ref };
  }
  /**
   * A reply letter (records, slides) to a contact who asked for it. The full outbound gate runs as for any message;
   * the gate is told the thread's real send/reply times (read from stored messages), so the follow-up cadence is
   * waived only while their reply is newer than our last send. Stores without reply support refuse.
   */
  private async approveReply(contact: Contact, draft: Draft, consent: { contactId: string; sharedFields: string[]; approvedAt: string }, record: NonNullable<Awaited<ReturnType<OutreachStore['getCase']>>>, now: string): Promise<SentApproveResult> {
    const { threadTimes, reserveReply, deliveredReply } = this.store;
    if (!threadTimes || !reserveReply || !deliveredReply) throw new OutreachError(409, ['reply_unsupported']);
    const times = await threadTimes.call(this.store, contact);
    const contacts = (await this.store.contacts(contact.caseId)).map(c => c.id === contact.id ? { ...c, lastSentAt: times.lastSentAt, lastReplyAt: times.lastReplyAt } : c);
    const gate = checkOutbound({ draft: { ...draft, approvedAt: now, isReply: true }, caseRecord: record, consent, contacts, allowlist: outboundAllowlist(this.env), now, mode: this.env.NODE_ENV === 'production' ? 'prod' : 'dev' });
    if (!gate.ok) throw new OutreachError(422, [...gate.reasons]);
    if (activeContactCount(contacts) > MAX_ACTIVE_CONTACTS) throw new OutreachError(422, ['contact_cap']);
    const channel = this.channels.find(c => c.kind === contact.channel);
    if (!channel) throw new OutreachError(503, ['channel_unavailable']);
    if (!await reserveReply.call(this.store, draft, now)) throw new OutreachError(409, ['already_approved_or_consent_changed']);
    let ref: ProviderRef;
    try { ref = await channel.send(gate.payload); } catch (error) {
      if (isDefiniteNonDelivery(error)) await this.store.unreserve?.(draft);
      throw error;
    }
    await deliveredReply.call(this.store, draft, ref, now);
    return { draftId: draft.id, approvedAt: now, sentAt: now, provider: ref };
  }
}

export interface ApproveOptions { voiceChannel?: Channel }
export type SentApproveResult = { draftId: string; approvedAt: string; sentAt: string; provider: ProviderRef };
export type ApproveResult = SentApproveResult | { draftId: string; approvedAt: string; queued: true; sentAt?: never; provider?: never };
