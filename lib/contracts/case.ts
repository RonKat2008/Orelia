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
  omim: code.nullable().optional(),
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

/**
 * Label stored as diseaseName when the patient has no diagnosis yet (the "undiagnosed" path). It is a label, never a
 * diagnosis: code must not guess, suggest or store a condition name for an undiagnosed case.
 */
export const UNDIAGNOSED_DISEASE_NAME = "Undiagnosed condition";

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
  /** True when the patient told us they have no diagnosis yet (diagnostic odyssey path). */
  undiagnosed: z.boolean().optional(),
  /** The patient's own description of their symptoms (undiagnosed path). Their words, quoted, never interpreted. */
  symptomNotes: plainText().pipe(z.string().max(LONG_TEXT_MAX)).optional(),
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

/**
 * An undiagnosed case never carries a diagnosis: the name becomes the fixed label and any extracted codes or subtype
 * are dropped, so no later step can treat a guess as the patient's condition. Other cases pass through unchanged.
 */
export function normalizeUndiagnosed<T extends Partial<CaseInput>>(input: T): T {
  if (input.undiagnosed !== true) return input;
  const { diseaseCodes: _codes, subtype: _subtype, ...rest } = input;
  void _codes;
  void _subtype;
  return { ...rest, diseaseName: UNDIAGNOSED_DISEASE_NAME, undiagnosed: true } as T;
}

export const isUndiagnosed = (c: Pick<CaseInput, "undiagnosed"> | null | undefined): boolean => c?.undiagnosed === true;
