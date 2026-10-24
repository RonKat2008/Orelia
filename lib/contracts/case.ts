import { z } from "zod";
import { plainText } from "./plain-text";
import { normalizeUsState } from "./us-state";

export const goalSchema = z.enum([
  "second_opinion",
  "treatment",
  "trial",
  "support",
  "aid",
]);

const code = plainText().pipe(z.string().max(50));

export const diseaseCodesSchema = z.object({
  orpha: code.nullable().optional(),
  mesh: code.nullable().optional(),
  icd10: code.nullable().optional(),
});

/** Bounds on a pasted report, shared by the API and the intake form. */
export const REPORT_TEXT_MIN = 20;
export const REPORT_TEXT_MAX = 60_000;

/** Longest text we accept for one case field. Reports are capped at 60k characters; a single field never needs more. */
const SHORT_TEXT_MAX = 300;
const LONG_TEXT_MAX = 2_000;
/** Farthest a patient could plausibly mean to travel; also keeps the value inside a Postgres integer. */
export const TRAVEL_LIMIT_MAX_MILES = 20_000;

const shortText = plainText().pipe(z.string().max(SHORT_TEXT_MAX));

const usStateSchema = plainText().transform((value, ctx) => {
  const state = normalizeUsState(value);
  if (!state) ctx.addIssue({ code: "custom", message: "Enter a US state: a two-letter code or the full name." });
  return state ?? value;
});

export const caseInputSchema = z.object({
  diseaseName: plainText().pipe(z.string().min(1).max(SHORT_TEXT_MAX)),
  diseaseCodes: diseaseCodesSchema.optional(),
  subtype: shortText.optional(),
  stageSummary: plainText().pipe(z.string().max(LONG_TEXT_MAX)).optional(),
  homeCity: shortText.optional(),
  homeState: usStateSchema.optional(),
  insurer: shortText.optional(),
  planId: shortText.optional(),
  travelLimitMiles: z.number().int().nonnegative().max(TRAVEL_LIMIT_MAX_MILES).optional(),
  goals: z
    .array(goalSchema)
    .max(goalSchema.options.length)
    .default([])
    .transform((goals) => [...new Set(goals)]),
});

export const caseSchema = caseInputSchema.extend({
  id: z.uuid(),
  status: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type CaseInput = z.infer<typeof caseInputSchema>;
export type Case = z.infer<typeof caseSchema>;
