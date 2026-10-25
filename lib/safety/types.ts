/** Standalone contracts; intentionally independent of database and validation libraries. */
export type Timestamp = string | Date;
export type CaseRecord = Readonly<Record<string, unknown>>;
export interface SafetyContact {
  readonly id?: string;
  readonly caseId?: string;
  readonly address?: string;
  /** The resource (target) this contact reaches; several contacts at one resource count once toward the cap. */
  readonly targetId?: string;
  readonly state: string;
  readonly lastSentAt?: Timestamp | null;
  readonly followUpsSent?: number;
  /** Latest inbound reply received on this contact's thread (read from stored messages by the caller). */
  readonly lastReplyAt?: Timestamp | null;
}
export type WebFormValueSource =
  | { readonly kind: 'consent'; readonly key: string }
  | { readonly kind: 'doc'; readonly docId: string; readonly snippet: string }
  | { readonly kind: 'disclosure' }
  /** The patient's own answer to this form's question; valid only if it matches SafetyConsent.formAnswers. */
  | { readonly kind: 'patient'; readonly origin: string };
export interface WebFormFieldValue {
  readonly fieldKey: string;
  readonly label: string;
  readonly type: string;
  readonly value: string | boolean;
  readonly source: WebFormValueSource;
}
export interface WebFormUpload { readonly fieldKey: string; readonly docId: string; readonly name: string }
/** Exactly what a web submit will type into the page; the gate checks every entry. */
export interface WebFormDraftPayload {
  /** fingerprintFields() of the form the patient reviewed; the channel refuses if the live page differs. */
  readonly formFingerprint: string;
  readonly fields: readonly WebFormFieldValue[];
  readonly uploads: readonly WebFormUpload[];
  /** True when the page has a free-text (textarea) field; then the disclosure note must be present in one. */
  readonly hasFreeText: boolean;
}
export interface SafetyDraft {
  /** For 'web_form', `address` is the form URL and `body` a human-readable summary of `webForm`. */
  readonly channel: 'email' | 'voice' | 'web_form';
  readonly webForm?: WebFormDraftPayload;
  readonly address: string;
  readonly body: string;
  readonly subject?: string;
  readonly contactId?: string;
  readonly caseId?: string;
  /** web_form only: the resource the form belongs to, so an application to an already-contacted resource is not a new contact. */
  readonly targetId?: string;
  readonly approvedAt?: Timestamp | null;
  readonly isFollowUp?: boolean;
  /**
   * An answer to something the contact asked for in a reply (records, slides). It is NOT a follow-up only while the
   * contact's own reply is newer than our last send (see checkOutbound): one answer per reply, never a nudge.
   */
  readonly isReply?: boolean;
}
export interface SafetyConsent {
  readonly sharedFields: readonly string[];
  /** case_documents ids the patient ticked; only these may be uploaded on a web form. */
  readonly sharedDocIds?: readonly string[];
  readonly contactId?: string;
  readonly approvedAt?: Timestamp | null;
  /**
   * web_form only: answers the patient typed or confirmed for THIS application (fieldKey -> value). They are the
   * patient's consent for this one form; a 'patient' field whose value is not here is refused.
   */
  readonly formAnswers?: Readonly<Record<string, string>>;
}
export type GateRefusal =
  | 'not_approved' | 'not_allowlisted' | 'contact_cap' | 'follow_up_cadence'
  | 'unshared_field' | 'missing_disclosure' | 'medical_advice'
  | 'invalid_draft' | 'consent_mismatch' | 'inactive_contact';
