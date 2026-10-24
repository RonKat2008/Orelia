import { z } from "zod";
import { caseInputSchema, normalizeUndiagnosed, UNDIAGNOSED_DISEASE_NAME, type CaseInput } from "@/lib/contracts";

/**
 * Undiagnosed answers from the question flow: structured, so the case is built in code with no model call and no
 * condition name (the fixed label stands in). Only these fields; anything else is rejected.
 */
export const undiagnosedFieldsSchema = caseInputSchema
  .pick({ homeCity: true, homeState: true, travelLimitMiles: true, goals: true, insurer: true, symptomNotes: true })
  .partial()
  .strict();

/** Case input for an undiagnosed patient's own answers: built in code, never by a model. */
export function undiagnosedCaseInput(fields: z.infer<typeof undiagnosedFieldsSchema>): CaseInput {
  return normalizeUndiagnosed(caseInputSchema.parse({ ...fields, goals: fields.goals ?? [], diseaseName: UNDIAGNOSED_DISEASE_NAME, undiagnosed: true }));
}
