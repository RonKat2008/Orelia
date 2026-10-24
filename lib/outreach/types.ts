import type { CaseRecord, SafetyContact, SafetyDraft } from '../safety/types';
import type { GatedDraft } from '../safety/outbound-gate';
export type Kind = 'expert' | 'institution' | 'trial' | 'organization';
export interface Candidate { id: string; caseId: string; targetId: string; targetKind: Kind; purpose?: 'advocacy' | 'financial_aid' | 'travel_aid'; evidence: { claim: string; claimType: string; sourceUrl: string }[] }
export interface Contact extends SafetyContact { id: string; caseId: string; targetId: string; targetKind: Kind; channel: 'email' | 'voice'; address: string; purpose?: Candidate['purpose'] }
export interface Consent { contactId: string; sharedFields: string[]; approvedAt: string }
export interface Draft extends SafetyDraft { id: string; contactId: string; caseId: string; sharedFields: string[]; sentAt?: string | null; approvedAt?: string | null }
export interface ProviderRef { messageId?: string; threadId?: string; callId?: string }
export interface Channel { kind: 'email' | 'voice'; send(draft: GatedDraft): Promise<ProviderRef> }
/** Atomic methods must serialize competing requests in the backing store. */
export interface OutreachStore {
  getCase(id: string): Promise<CaseRecord | undefined>;
  candidates(caseId: string, ids: string[]): Promise<Candidate[]>;
  contacts(caseId: string): Promise<Contact[]>;
  contact(id: string): Promise<Contact | undefined>;
  select(caseId: string, contacts: Contact[], cap: number): Promise<Contact[]>;
  consent(id: string): Promise<Consent | undefined>;
  saveConsent(consent: Consent): Promise<void>;
  saveDraft(draft: Draft): Promise<void>;
  draft(id: string, contact: Contact): Promise<Draft | undefined>;
  /** Compare-and-set: reserve approval BEFORE sending; never automatically retry an ambiguous send. */
  reserve(draft: Draft, approvedAt: string): Promise<boolean>;
  delivered(draft: Draft, ref: ProviderRef, sentAt: string): Promise<void>;
}
export class OutreachError extends Error { constructor(public status: number, public reasons: string[]) { super(reasons.join(', ')); } }
