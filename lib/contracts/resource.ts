import { z } from "zod";

const evidenceRefs = z.array(z.string());

/** "registry" = a patient registry (often joined through a form or an email), stamped by code. */
export const ORGANIZATION_KINDS = ["advocacy", "financial_aid", "travel_aid", "registry"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** Code-sourced facts about a person's publication footprint (stamped from tool output, never by a model). */
export const expertProfileSchema = z.object({
  paperCount: z.number().int().nonnegative().optional(),
  recentPaperCount: z.number().int().nonnegative().optional(),
  affiliation: z.string().optional(),
  state: z.string().optional(),
});

/** Code-sourced ClinicalTrials.gov facts used by the relevance filters and ranking signals. */
export const trialRegistrySchema = z.object({
  conditions: z.array(z.string()),
  keywords: z.array(z.string()),
  meshTerms: z.array(z.string()),
  stdAges: z.array(z.string()),
  minimumAge: z.string().optional(),
  maximumAge: z.string().optional(),
  phases: z.array(z.string()),
  usSiteCount: z.number().int().nonnegative(),
  usRecruitingSiteCount: z.number().int().nonnegative(),
  recruitingSiteStates: z.array(z.string()),
  investigators: z.array(z.string()),
  hasContact: z.boolean(),
});

const expertResourceSchema = z.object({
  kind: z.literal("expert"),
  id: z.string().min(1),
  name: z.string().min(1),
  npi: z.string().nullable().optional(),
  /** True only when NPPES returned exactly one exact-name match for this person. */
  verified: z.boolean().optional(),
  profile: expertProfileSchema.optional(),
  credentials: z.string().optional(),
  specialty: z.string().optional(),
  institutionId: z.string().optional(),
  evidenceRefs,
});

const institutionResourceSchema = z.object({
  kind: z.literal("institution"),
  id: z.string().min(1),
  name: z.string().min(1),
  institutionKind: z.enum(["cancer_center", "rare_disease_center", "hospital"]).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  evidenceRefs,
});

const trialResourceSchema = z.object({
  kind: z.literal("trial"),
  id: z.string().min(1),
  nctId: z.string().min(1),
  title: z.string().min(1),
  status: z.string().optional(),
  /** ClinicalTrials.gov study type, stamped by code from the registry. Observational = natural-history / cohort study. */
  studyType: z.enum(["interventional", "observational"]).optional(),
  registry: trialRegistrySchema.optional(),
  evidenceRefs,
});

const organizationResourceSchema = z.object({
  kind: z.literal("organization"),
  id: z.string().min(1),
  name: z.string().min(1),
  organizationKind: z.enum(ORGANIZATION_KINDS).optional(),
  url: z.url().optional(),
  evidenceRefs,
});

export const resourceSchema = z.discriminatedUnion("kind", [
  expertResourceSchema,
  institutionResourceSchema,
  trialResourceSchema,
  organizationResourceSchema,
]);

export type ExpertProfile = z.infer<typeof expertProfileSchema>;
export type TrialRegistry = z.infer<typeof trialRegistrySchema>;
export type Resource = z.infer<typeof resourceSchema>;
