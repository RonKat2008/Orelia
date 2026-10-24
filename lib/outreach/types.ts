import type { CaseRecord, SafetyContact, SafetyDraft } from '../safety/types';
import type { GatedDraft } from '../safety/outbound-gate';
import type { OrganizationKind } from '@/lib/contracts';
export type Kind = 'expert' | 'institution' | 'trial' | 'organization';
export interface Candidate { id: string; caseId: string; targetId: string; targetKind: Kind; purpose?: OrganizationKind; evidence: { claim: string; claimType: string; sourceUrl: string }[] }
export interface Contact extends SafetyContact { id: string; caseId: string; targetId: string; targetKind: Kind; channel: 'email' | 'voice'; address: string; purpose?: Candidate['purpose'] }
export interface Consent { contactId: string; sharedFields: string[]; approvedAt: string }
export interface Draft extends Omit<SafetyDraft, 'channel'> { channel: 'email' | 'voice'; contextDocIds?: string[]; id: string; contactId: string; caseId: string; sharedFields: string[]; sentAt?: string | null; approvedAt?: string | null; /** follow_up_1 / follow_up_2 for follow-up messages, reply_records / reply_slides for reply letters; null/absent for the first message. */ classification?: string | null }
/** Reply letters (records, slides) answer a request the contact made; see checkOutbound's reply rule. */
export const REPLY_CLASSIFICATION_PREFIX = 'reply_';
export const isReplyClassification = (c: string | null | undefined): c is string => !!c && c.startsWith(REPLY_CLASSIFICATION_PREFIX);
export interface ProviderRef { messageId?: string; threadId?: string; callId?: string }
export interface Channel { kind: 'email' | 'voice'; send(draft: GatedDraft): Promise<ProviderRef> }
export interface SelectOptions { sharedAddresses?: readonly string[] }
/** Atomic methods must serialize competing requests in the backing store. */
export interface OutreachStore {
  getCase(id: string): Promise<CaseRecord | undefined>;
  candidates(caseId: string, ids: string[]): Promise<Candidate[]>;
  contacts(caseId: string): Promise<Contact[]>;
  contact(id: string): Promise<Contact | undefined>;
  /**
   * Insert contacts, skipping any whose normalized address a contact on the case already uses. `sharedAddresses`
   * (demo coordinator inboxes only) lists addresses that MAY be used by several contacts: for those the dedupe
   * key is address + target, so each resource still gets at most one contact.
   */
  select(caseId: string, contacts: Contact[], cap: number, opts?: SelectOptions): Promise<Contact[]>;
  consent(id: string): Promise<Consent | undefined>;
  saveConsent(consent: Consent): Promise<void>;
  saveDraft(draft: Draft): Promise<void>;
  /**
   * Optional: a first-message draft for this contact that is neither approved nor sent and was written for
   * exactly these shared fields. When present, draft() returns it instead of writing a duplicate.
   */
  pendingDraft?(contact: Contact, sharedFields: readonly string[]): Promise<Draft | undefined>;
  /** Optional: the most recent first message already sent to this contact. draft() returns it once the contact left 'drafted'. */
  sentDraft?(contact: Contact): Promise<Draft | undefined>;
  /**
   * Optional: a follow-up (follow_up_*) drafted by the workflow/cron sweep that is neither approved nor sent. While the
   * contact is waiting ('sent'), draft() returns it so the outbox offers it for approval instead of the sent message.
   */
  pendingFollowUp?(contact: Contact): Promise<Draft | undefined>;
  /**
   * Optional: replace the body of a draft that is still neither approved nor sent (compare-and-set). Used to attach a
   * patient-reviewed packet before approval. False when the draft was already approved/sent or does not belong to the contact.
   */
  updateDraftBody?(draftId: string, contactId: string, body: string): Promise<boolean>;
  /**
   * Optional: a reply letter (classification reply_*) written when the contact asked for records or slides, neither
   * approved nor sent. Once the contact has left 'drafted', draft() returns it ahead of anything else.
   */
  pendingReply?(contact: Contact): Promise<Draft | undefined>;
  /** Optional: latest outbound send and latest inbound reply on this contact's thread, for the gate's reply rule. */
  threadTimes?(contact: Contact): Promise<{ lastSentAt: string | null; lastReplyAt: string | null }>;
  /**
   * Optional: compare-and-set approval of a reply letter. True only while the draft is unapproved and unsent, the
   * consent still matches, the contact has replied since our last send and no other outbound is approved and unsent.
   */
  reserveReply?(draft: Draft, approvedAt: string): Promise<boolean>;
  /** Optional: a reply letter went out. The contact moves to 'records_sent' (TASK_DONE), not back to 'sent'. */
  deliveredReply?(draft: Draft, ref: ProviderRef, sentAt: string): Promise<void>;
  draft(id: string, contact: Contact): Promise<Draft | undefined>;
  /** Compare-and-set: reserve approval BEFORE sending; never automatically retry an ambiguous send. */
  reserve(draft: Draft, approvedAt: string): Promise<boolean>;
  /** Optional: undo reserve() after the provider definitely rejected the send (nothing went out), so the patient can retry. */
  unreserve?(draft: Draft): Promise<void>;
  delivered(draft: Draft, ref: ProviderRef, sentAt: string): Promise<void>;
}
export class OutreachError extends Error { constructor(public status: number, public reasons: string[]) { super(reasons.join(', ')); } }
