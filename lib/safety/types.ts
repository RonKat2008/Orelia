/** Standalone contracts; intentionally independent of database and validation libraries. */
export type Timestamp = string | Date;
export type CaseRecord = Readonly<Record<string, unknown>>;
export interface SafetyContact {
  readonly id?: string;
  readonly caseId?: string;
  readonly address?: string;
  readonly state: string;
  readonly lastSentAt?: Timestamp | null;
  readonly followUpsSent?: number;
}
export interface SafetyDraft {
  readonly channel: 'email' | 'voice';
  readonly address: string;
  readonly body: string;
  readonly subject?: string;
  readonly contactId?: string;
  readonly caseId?: string;
  readonly approvedAt?: Timestamp | null;
  readonly isFollowUp?: boolean;
}
export interface SafetyConsent {
  readonly sharedFields: readonly string[];
  readonly contactId?: string;
  readonly approvedAt?: Timestamp | null;
}
export type GateRefusal =
  | 'not_approved' | 'not_allowlisted' | 'contact_cap' | 'follow_up_cadence'
  | 'unshared_field' | 'missing_disclosure' | 'medical_advice'
  | 'invalid_draft' | 'consent_mismatch' | 'inactive_contact';
