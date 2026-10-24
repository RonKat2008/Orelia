import { createHash } from 'node:crypto';
import { followUpContent } from '../workflows/contact-store';

export type FollowUpNumber = 1 | 2;
export type OutreachChannel = 'email' | 'voice';

/** Case fields that can change what a patient consented to share. Notify columns are excluded. */
export interface CaseSnapshot {
  diseaseName: string;
  diseaseCodes: unknown;
  subtype: string | null;
  stageSummary: string | null;
  homeCity: string | null;
  homeState: string | null;
  insurer: string | null;
  planId: string | null;
  travelLimitMiles: number | null;
  goals: readonly string[];
}

export interface PreapprovedMessage {
  id: string;
  contactId: string;
  classification: `follow_up_${FollowUpNumber}`;
  channel: OutreachChannel;
  body: string;
  subject: string | null;
  sharedFields: readonly string[];
  approvedAt: string | null;
  sentAt: string | null;
  approvalFingerprint: string | null;
}

export interface ApprovalContext {
  snapshot: CaseSnapshot;
  sharedFields: readonly string[];
  /** ISO time of the consent row. A later consent approval invalidates pre-approved follow-ups. */
  consentApprovedAt: string | null;
  contactState: string;
}

export function canonicalFollowUp(channel: OutreachChannel): { subject: string | null; body: string } {
  const content = followUpContent(channel);
  return { subject: content.subject ?? null, body: content.body };
}

export function approvalFingerprint(snapshot: CaseSnapshot, sharedFields: readonly string[], consentApprovedAt: string): string {
  const payload = JSON.stringify({
    snapshot: {
      ...snapshot,
      goals: [...snapshot.goals].sort(),
    },
    sharedFields: [...sharedFields].sort(),
    consentApprovedAt,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export type PreapproveBlock =
  | 'not_approved'
  | 'already_sent'
  | 'replied'
  | 'declined'
  | 'consent_changed'
  | 'case_changed'
  | 'body_differs';

/**
 * The timer may send only the stored body. Any consent or case change, or a body
 * that would no longer match the canonical follow-up, blocks the send.
 */
export function assessPreapproved(
  row: PreapprovedMessage,
  current: ApprovalContext,
): { ok: true; body: string; subject: string | null; sharedFields: readonly string[]; approvedAt: string } | { ok: false; reason: PreapproveBlock } {
  if (row.sentAt) return { ok: false, reason: 'already_sent' };
  if (!row.approvedAt) return { ok: false, reason: 'not_approved' };
  if (current.contactState === 'replied') return { ok: false, reason: 'replied' };
  if (current.contactState === 'declined') return { ok: false, reason: 'declined' };
  const canonical = canonicalFollowUp(row.channel);
  if (row.body !== canonical.body || (row.subject ?? null) !== canonical.subject) {
    return { ok: false, reason: 'body_differs' };
  }
  if (!current.consentApprovedAt) return { ok: false, reason: 'consent_changed' };
  const nowPrint = approvalFingerprint(current.snapshot, current.sharedFields, current.consentApprovedAt);
  if (row.approvalFingerprint !== nowPrint) {
    const sameFields =
      [...row.sharedFields].sort().join('\0') === [...current.sharedFields].sort().join('\0');
    return { ok: false, reason: sameFields ? 'case_changed' : 'consent_changed' };
  }
  return { ok: true, body: row.body, subject: row.subject, sharedFields: row.sharedFields, approvedAt: row.approvedAt };
}
