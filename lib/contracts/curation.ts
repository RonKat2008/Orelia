import { z } from "zod";

/** Curator output: fit/access tiers per candidate with evidence-cited reasons. Never about treatments. */
export const curationTierSchema = z.enum(["best", "good", "backup", "exclude"]);

export const curationReasonSchema = z.object({
  text: z.string().min(1).max(400),
  evidenceIds: z.array(z.string()),
});

export const curationPickSchema = z.object({
  candidateId: z.string().min(1),
  tier: curationTierSchema,
  reasons: z.array(curationReasonSchema).max(4),
});

export const curationSchema = z.object({
  picks: z.array(curationPickSchema),
  summary: z.string().max(1200),
});

export type CurationTier = z.infer<typeof curationTierSchema>;
export type CurationReason = z.infer<typeof curationReasonSchema>;
export type CurationPick = z.infer<typeof curationPickSchema>;
export type Curation = z.infer<typeof curationSchema>;
