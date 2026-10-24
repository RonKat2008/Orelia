import { z } from "zod";

const evidenceRefs = z.array(z.string());

const expertResourceSchema = z.object({
  kind: z.literal("expert"),
  id: z.string().min(1),
  name: z.string().min(1),
  npi: z.string().nullable().optional(),
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
  evidenceRefs,
});

const organizationResourceSchema = z.object({
  kind: z.literal("organization"),
  id: z.string().min(1),
  name: z.string().min(1),
  organizationKind: z.enum(["advocacy", "financial_aid", "travel_aid"]).optional(),
  url: z.url().optional(),
  evidenceRefs,
});

export const resourceSchema = z.discriminatedUnion("kind", [
  expertResourceSchema,
  institutionResourceSchema,
  trialResourceSchema,
  organizationResourceSchema,
]);

export type Resource = z.infer<typeof resourceSchema>;
