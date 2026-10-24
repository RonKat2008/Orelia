import { z } from "zod";

/**
 * CareNeeds: what a person with this condition should look for in a SERVICE (specialists, centers, trials,
 * support). Never treatment advice. Every item cites evidence ids (source ids such as "genereviews:NBK1494")
 * that resolve to a fetched source URL; code drops any item that does not (lib/agents/needs/validate.ts).
 */

const id = z.string().min(1).max(80);
const evidenceIds = z.array(z.string().min(1).max(160)).max(6);
/** What to look for, phrased about a service ("A center with ..."), plus a plain-language version for the patient view. */
const text = z.string().min(1).max(400);
const plain = z.string().min(1).max(300);
/** Short search phrases (2-6 words) code may add to resource searches. Only kept items' terms are used. */
const searchTerms = z.array(z.string().min(2).max(60)).max(3).default([]);

export const NEED_RESOURCE_KINDS = ["expert", "institution", "trial", "organization"] as const;
export const needResourceKindSchema = z.enum(NEED_RESOURCE_KINDS);

export const specialtyNeedSchema = z.object({
  id,
  specialty: z.string().min(1).max(120),
  subspecialty: z.string().max(120).optional(),
  why: text,
  plain,
  evidenceIds,
  searchTerms,
});

export const capabilityNeedSchema = z.object({ id, text, plain, evidenceIds, searchTerms });

export const redFlagSchema = z.object({
  id,
  text,
  plain,
  /** Resource kinds this red flag applies to. */
  appliesTo: z.array(needResourceKindSchema).min(1).max(4),
  evidenceIds,
});

export const ELIGIBILITY_FEATURES = [
  "diagnosis_confirmation",
  "genetic_variant",
  "prior_therapy_lines",
  "performance_status",
  "age",
  "organ_function",
  "disease_stage",
  "other",
] as const;

export const eligibilityFeatureSchema = z.object({
  id,
  feature: z.enum(ELIGIBILITY_FEATURES),
  /** What a trial listing typically asks about (to check, never to advise). */
  text,
  plain,
  evidenceIds,
});

export const SUPPORT_KINDS = ["advocacy", "travel_lodging", "genetic_counseling_cost", "financial", "emotional_support", "other"] as const;

export const supportNeedSchema = z.object({
  id,
  kind: z.enum(SUPPORT_KINDS),
  text,
  plain,
  /** Organizations a source names as serving this condition (names only; the search agents find and verify them). */
  organizations: z.array(z.string().min(1).max(120)).max(4).default([]),
  evidenceIds,
  searchTerms,
});

export const resourceQuestionSchema = z.object({
  id,
  resourceKind: needResourceKindSchema,
  /** A question the patient can ask this kind of resource. Must end with "?"; never a recommendation. */
  text: z.string().min(5).max(300),
  evidenceIds,
});

/** What the model returns (before deterministic validation). */
export const generatedNeedsSchema = z.object({
  specialties: z.array(specialtyNeedSchema).max(8).default([]),
  centerCapabilities: z.array(capabilityNeedSchema).max(8).default([]),
  redFlags: z.array(redFlagSchema).max(8).default([]),
  trialEligibility: z.array(eligibilityFeatureSchema).max(8).default([]),
  supportNeeds: z.array(supportNeedSchema).max(8).default([]),
  questions: z.array(resourceQuestionSchema).max(16).default([]),
});
export type GeneratedNeeds = z.infer<typeof generatedNeedsSchema>;

export const needSourceSchema = z.object({
  id: z.string().min(1).max(160),
  url: z.url(),
  title: z.string().min(1).max(400),
  kind: z.string().min(1).max(40),
  fetchedAt: z.iso.datetime(),
});
export type NeedSource = z.infer<typeof needSourceSchema>;

export const needsSearchTermsSchema = z.object({
  centers: z.array(z.string()).max(4),
  experts: z.array(z.string()).max(4),
  trials: z.array(z.string()).max(4),
  advocacy: z.array(z.string()).max(4),
  aid: z.array(z.string()).max(4),
});
export type NeedsSearchTerms = z.infer<typeof needsSearchTermsSchema>;

/** Disease-level needs: cacheable across cases (contains no personal fields). */
export const careNeedsBaseSchema = generatedNeedsSchema.extend({
  cacheKey: z.string().min(1).max(200),
  diseaseName: z.string().min(1).max(300),
  subtype: z.string().max(300).optional(),
  generatedAt: z.iso.datetime(),
  mode: z.enum(["live", "offline", "fallback"]),
  sources: z.array(needSourceSchema),
  searchTerms: needsSearchTermsSchema,
  dropped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type CareNeedsBase = z.infer<typeof careNeedsBaseSchema>;

/** Per-case notes derived by code from the case (location, travel, goals, insurer, documents). Never model output. */
export const needsPersonalNoteSchema = z.object({
  id,
  text: z.string().min(1).max(300),
});

export const careNeedsSchema = careNeedsBaseSchema.extend({
  caseId: z.string().min(1),
  fromCache: z.boolean(),
  /** Elapsed ms to produce the needs for this case (cache hits are near zero). */
  elapsedMs: z.number().int().nonnegative(),
  personal: z.object({
    homeState: z.string().optional(),
    travelLimitMiles: z.number().int().nonnegative().optional(),
    goals: z.array(z.string()),
    notes: z.array(needsPersonalNoteSchema).max(8),
  }),
});
export type CareNeeds = z.infer<typeof careNeedsSchema>;
export type SpecialtyNeed = z.infer<typeof specialtyNeedSchema>;
export type CapabilityNeed = z.infer<typeof capabilityNeedSchema>;
export type RedFlag = z.infer<typeof redFlagSchema>;
export type EligibilityFeature = z.infer<typeof eligibilityFeatureSchema>;
export type SupportNeed = z.infer<typeof supportNeedSchema>;
export type ResourceQuestion = z.infer<typeof resourceQuestionSchema>;
export type NeedResourceKind = z.infer<typeof needResourceKindSchema>;
