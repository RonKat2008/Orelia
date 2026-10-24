import { z } from "zod";
import { curationTierSchema } from "./curation";

/**
 * Final judge: one verdict per verified, ranked candidate. The model proposes; lib/agents/judge/guardrails.ts
 * decides what survives (no keep without evidence, no invented evidence ids, hard scope rules win, every drop has
 * a reason, stable sorted output). Verdicts are about fit and access to a service, never about treatments.
 */
export const judgeVerdictSchema = z.enum(["keep", "maybe", "drop"]);
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export const judgeConfidenceSchema = z.enum(["high", "medium", "low"]);
export type JudgeConfidence = z.infer<typeof judgeConfidenceSchema>;

/** What the model returns for one candidate. */
export const rawJudgementSchema = z.object({
  candidateId: z.string().min(1),
  verdict: judgeVerdictSchema,
  tier: curationTierSchema.exclude(["exclude"]),
  /** Short reason naming specific needs met or missed, e.g. "Has a connective-tissue vascular clinic · treats adults". */
  reason: z.string().min(1).max(400),
  /** Plain one-sentence version for the patient view. */
  plain: z.string().min(1).max(240),
  evidenceIds: z.array(z.string().min(1)).max(8),
  /** CareNeeds item ids this candidate meets / misses. */
  needsMet: z.array(z.string()).max(8).default([]),
  needsMissed: z.array(z.string()).max(8).default([]),
  confidence: judgeConfidenceSchema,
});
export type RawJudgement = z.infer<typeof rawJudgementSchema>;

export const rawJudgeOutputSchema = z.object({
  judgements: z.array(rawJudgementSchema).max(80),
  summary: z.string().max(800).default(""),
});
export type RawJudgeOutput = z.infer<typeof rawJudgeOutputSchema>;

export const scopeFlagSchema = z.object({
  code: z.enum(["pediatric_only", "non_us", "beyond_travel", "out_of_state_license", "not_recruiting"]),
  /** Hard flags force a drop; soft flags cap the tier and are always shown. */
  hard: z.boolean(),
  text: z.string().min(1).max(200),
});
export type ScopeFlag = z.infer<typeof scopeFlagSchema>;

/** One validated verdict as stored and shown. */
export const judgementSchema = z.object({
  candidateId: z.string().min(1),
  kind: z.enum(["expert", "institution", "trial", "organization"]),
  name: z.string().min(1),
  verdict: judgeVerdictSchema,
  tier: curationTierSchema,
  reason: z.string().min(1).max(600),
  plain: z.string().min(1).max(300),
  evidenceIds: z.array(z.string()),
  /** Source links for the cited evidence (code-joined from the candidate's own evidence). */
  links: z.array(z.object({ id: z.string(), url: z.url(), claim: z.string().max(300) })).max(8),
  /** Stable identifiers for matching shortlist cards (persisted ids may differ from canonical candidate ids). */
  nctId: z.string().optional(),
  npi: z.string().optional(),
  needsMet: z.array(z.string()),
  needsMissed: z.array(z.string()),
  confidence: judgeConfidenceSchema,
  flags: z.array(scopeFlagSchema),
  /** Deterministic score and rank from lib/ranking (shown next to the verdict, never hidden). */
  score: z.number(),
  rank: z.number().int(),
  /** Combined order key: verdict band first, then the deterministic score (see guardrails.combinedOrder). */
  order: z.number().int(),
  /** What code changed and why (e.g. "keep without evidence -> drop"). */
  overrides: z.array(z.string()),
  source: z.enum(["model", "fallback"]),
});
export type Judgement = z.infer<typeof judgementSchema>;

export const judgeResultSchema = z.object({
  caseId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  source: z.enum(["model", "fallback"]),
  model: z.string(),
  summary: z.string(),
  counts: z.object({ keep: z.number().int(), maybe: z.number().int(), drop: z.number().int() }),
  judgements: z.array(judgementSchema),
  /** Model output code rejected outright (unknown candidate, duplicate, invented evidence id...). */
  rejected: z.array(z.object({ candidateId: z.string().optional(), why: z.string() })),
  elapsedMs: z.number().int().nonnegative(),
});
export type JudgeResult = z.infer<typeof judgeResultSchema>;
