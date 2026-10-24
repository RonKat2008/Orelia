/**
 * Verification-call contract (FROZEN for the rd-experts lane; UI and backend both code against it).
 *
 * A verification call is a short AI voice call (AgentCall) to a resource's code-stamped phone contact point that asks
 * ONLY the six questions below. The disclosure is spoken first. The only patient detail shared is the diagnosis name
 * (and the insurer name only if the patient ticked it). Nothing is dialed until the patient approves the specific
 * request (approvedAt) AND checkOutbound returns a GatedDraft.
 * The transcript is untrusted data. Each answer must quote the callee verbatim; an answer whose quote is not found in
 * a callee turn of the transcript is downgraded to 'unclear'.
 */
import { z } from 'zod';

export const VERIFY_QUESTION_KEYS = [
  'treats_condition',
  'new_adult_patients',
  'referral_required',
  'consultations',
  'how_to_start',
  'insurance',
] as const;
export const verifyQuestionKeySchema = z.enum(VERIFY_QUESTION_KEYS);
export type VerifyQuestionKey = z.infer<typeof verifyQuestionKeySchema>;

/** Fields a verification call may ever share. diseaseName is required; insurer only when ticked. */
export const VERIFY_ALLOWED_FIELDS = ['diseaseName', 'insurer'] as const;
export const verifySharedFieldsSchema = z.array(z.enum(VERIFY_ALLOWED_FIELDS)).min(1).max(2)
  .refine(f => f.includes('diseaseName'), 'diseaseName must be shared to ask about the condition')
  .refine(f => new Set(f).size === f.length, 'duplicate field');

export const answerValueSchema = z.enum(['yes', 'no', 'unclear', 'not_asked']);
export type AnswerValue = z.infer<typeof answerValueSchema>;

export const verificationAnswerSchema = z.object({
  key: verifyQuestionKeySchema,
  value: answerValueSchema,
  /** how_to_start only: short first step, taken from the quote (<= 300 chars, sanitized). */
  detail: z.string().max(300).nullable(),
  /** Verbatim callee words supporting the answer; null when unclear / not asked. */
  quote: z.string().max(500).nullable(),
  /** Index of the transcript turn the quote came from. */
  turnIndex: z.number().int().nonnegative().nullable(),
}).superRefine((a, ctx) => {
  if ((a.value === 'yes' || a.value === 'no') && (!a.quote || a.turnIndex === null)) ctx.addIssue({ code: 'custom', message: 'yes/no answers need a transcript quote' });
  if (a.key === 'how_to_start' && a.value === 'yes' && !a.detail) ctx.addIssue({ code: 'custom', message: 'how_to_start answer needs detail' });
});
export type VerificationAnswer = z.infer<typeof verificationAnswerSchema>;

export const transcriptTurnSchema = z.object({
  speaker: z.enum(['agent', 'callee']),
  text: z.string().max(4000),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const verificationResultSchema = z.object({
  requestId: z.string().min(1),
  callId: z.string().min(1),
  calledAt: z.iso.datetime(),
  answers: z.array(verificationAnswerSchema).length(VERIFY_QUESTION_KEYS.length),
  /** 'deterministic' parser or 'llm' extraction (always re-checked against the transcript by code). */
  parser: z.enum(['deterministic', 'llm']),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const verificationStatusSchema = z.enum(['awaiting_approval', 'calling', 'completed', 'failed', 'blocked']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const verificationRequestSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  /** `${targetKind}:${targetId}` (same key as the shortlist / plan). */
  resourceKey: z.string().min(3),
  targetKind: z.enum(['expert', 'institution', 'trial', 'organization']),
  targetId: z.string().min(1),
  name: z.string().min(1),
  /** E.164 phone from a code-stamped contact_point.voice.* evidence row. */
  phone: z.string().regex(/^\+\d{8,15}$/),
  phoneEvidenceId: z.string().min(1),
  sharedFields: verifySharedFieldsSchema,
  /** Exactly what the AI caller will say/ask; starts with AI_DISCLOSURE_VOICE. Shown to the patient before approval. */
  script: z.string().min(1).max(4000),
  status: verificationStatusSchema,
  createdAt: z.iso.datetime(),
  approvedAt: z.iso.datetime().nullable(),
  callId: z.string().nullable(),
  result: verificationResultSchema.nullable(),
  /** Evidence ids written from the result (claimType "verification.<key>", sourceKind "phone_call"). */
  evidenceIds: z.array(z.string()),
  /** Gate refusal codes when status is 'blocked'. Codes only, never provider text. */
  blockedReasons: z.array(z.string()),
});
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;

/** One badge per yes/no answer, e.g. "Verified by phone on Oct 24, 2026: accepts new adult patients". */
export const verificationBadgeSchema = z.object({
  resourceKey: z.string().min(3),
  key: verifyQuestionKeySchema,
  value: z.enum(['yes', 'no']),
  label: z.string().min(1).max(160),
  verifiedAt: z.iso.datetime(),
  evidenceId: z.string().min(1),
});
export type VerificationBadge = z.infer<typeof verificationBadgeSchema>;

/**
 * HTTP, ownership guard + same-origin + jsonError envelope like /plan:
 *   GET  /api/cases/[id]/verifications                 -> 200 { requests: VerificationRequest[], badges: Record<resourceKey, VerificationBadge[]> }
 *   POST /api/cases/[id]/verifications                 body verifyCreateBodySchema -> 201 { request }  (script preview; NOTHING is dialed)
 *        422 { error } when the resource has no code-stamped phone contact point.
 *   POST /api/cases/[id]/verifications/[vid]/approve   body {} -> 200 { request }  (sets approvedAt, checkOutbound, AgentCall)
 *        422 { error, reasons? } when the gate refuses (request status becomes 'blocked').
 */
export const verifyCreateBodySchema = z.object({
  resourceKey: z.string().min(3).max(200),
  sharedFields: verifySharedFieldsSchema,
});
export type VerifyCreateBody = z.infer<typeof verifyCreateBodySchema>;

export const verificationsResponseSchema = z.object({
  requests: z.array(verificationRequestSchema),
  badges: z.record(z.string(), z.array(verificationBadgeSchema)),
});
export type VerificationsResponse = z.infer<typeof verificationsResponseSchema>;
