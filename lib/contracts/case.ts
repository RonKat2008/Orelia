import { z } from "zod";

export const goalSchema = z.enum([
  "second_opinion",
  "treatment",
  "trial",
  "support",
  "aid",
]);

export const diseaseCodesSchema = z.object({
  orpha: z.string().optional(),
  mesh: z.string().optional(),
  icd10: z.string().optional(),
});

export const caseInputSchema = z.object({
  diseaseName: z.string().min(1),
  diseaseCodes: diseaseCodesSchema.optional(),
  subtype: z.string().optional(),
  stageSummary: z.string().optional(),
  homeCity: z.string().optional(),
  homeState: z.string().optional(),
  insurer: z.string().optional(),
  planId: z.string().optional(),
  travelLimitMiles: z.number().int().nonnegative().optional(),
  goals: z.array(goalSchema).default([]),
});

export const caseSchema = caseInputSchema.extend({
  id: z.uuid(),
  status: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type CaseInput = z.infer<typeof caseInputSchema>;
export type Case = z.infer<typeof caseSchema>;
