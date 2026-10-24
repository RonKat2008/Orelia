import { z } from "zod";

export const sourceKindSchema = z.enum(["pubmed", "ctgov", "nppes", "nci", "exa"]);

export const evidenceSchema = z.object({
  /** Optional stable id; assigned by code (never a model) so records can cite one specific claim. */
  id: z.string().min(1).optional(),
  claimType: z.string().min(1),
  claim: z.string().min(1),
  sourceUrl: z.url(),
  sourceKind: sourceKindSchema,
  fetchedAt: z.iso.datetime(),
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
