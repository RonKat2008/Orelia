/**
 * Verification result -> evidence rows (claimType "verification.<key>", sourceKind "phone_call"). Only decisive
 * yes/no answers and the how_to_start detail become evidence; unclear / not-asked answers never do. The source URL
 * identifies the call record inside Wayfinder (the transcript lives in the case threads), not a third-party page.
 */
import { createHash } from 'node:crypto';
import { neutralizeUntrusted } from '../agents/research/untrusted';
import type { Evidence } from '../contracts/evidence';
import type { VerificationAnswer, VerificationRequest, VerificationResult, VerifyQuestionKey } from './contract';

export type VerificationEvidence = Evidence & { id: string };

export const VERIFICATION_CLAIM_PREFIX = 'verification';

/** Plain-language phrase per key and value (used in claims and badges). */
export const ANSWER_PHRASES: Record<VerifyQuestionKey, { yes: string; no: string }> = {
  treats_condition: { yes: 'treats patients with this condition', no: 'does not treat patients with this condition' },
  new_adult_patients: { yes: 'accepts new adult patients', no: 'not accepting new adult patients' },
  referral_required: { yes: 'referral needed', no: 'no referral needed' },
  consultations: { yes: 'offers consultations or second opinions', no: 'does not offer second opinions' },
  how_to_start: { yes: 'explained how new patients start', no: 'did not explain how new patients start' },
  insurance: { yes: 'accepts your insurance', no: 'does not accept your insurance' },
};

/** Deterministic UUID per request + key, so re-ingesting the same call never duplicates rows. */
export function verificationEvidenceId(requestId: string, key: VerifyQuestionKey): string {
  const h = createHash('sha256').update(`verification:${requestId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const isoDay = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

/** Link to the call record in the case threads; https in deployments (http only for a localhost base). */
export function callRecordUrl(appBaseUrl: string, caseId: string, callId: string): string {
  const base = appBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/cases/${encodeURIComponent(caseId)}/threads`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && /^(?:localhost|127\.0\.0\.1)$/.test(url.hostname))) throw new Error('appBaseUrl must be https');
  url.searchParams.set('call', callId);
  return url.toString();
}

/** True for answers that may become evidence / badges. */
export function isEvidenceAnswer(a: VerificationAnswer): boolean {
  if (a.key === 'how_to_start') return a.value === 'yes' && !!a.detail && !!a.quote;
  return (a.value === 'yes' || a.value === 'no') && !!a.quote && a.turnIndex !== null;
}

const quoted = (text: string) => neutralizeUntrusted(text).replace(/"/g, "'").slice(0, 500);

export function claimFor(a: VerificationAnswer, calledAt: string): string {
  const day = isoDay(calledAt);
  if (a.key === 'how_to_start') return `Verified by phone on ${day}: how a new patient starts: "${quoted(a.detail ?? '')}".`;
  return `Verified by phone on ${day}: "${quoted(a.quote ?? '')}" — ${ANSWER_PHRASES[a.key][a.value as 'yes' | 'no']}.`;
}

export function resultToEvidence(
  request: Pick<VerificationRequest, 'id' | 'caseId'>, result: VerificationResult, appBaseUrl: string,
): VerificationEvidence[] {
  const sourceUrl = callRecordUrl(appBaseUrl, request.caseId, result.callId);
  return result.answers.filter(isEvidenceAnswer).map(a => ({
    id: verificationEvidenceId(request.id, a.key),
    claimType: `${VERIFICATION_CLAIM_PREFIX}.${a.key}`,
    claim: claimFor(a, result.calledAt),
    sourceUrl,
    sourceKind: 'phone_call' as const,
    fetchedAt: result.calledAt,
  }));
}
