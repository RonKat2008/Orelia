import { z } from 'zod';

/** Where a filled value came from. Values are never free-form: consent fields are copied by key, doc values must appear in the snippet. */
export const valueSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('consent'), key: z.string().min(1) }),
  z.object({ kind: z.literal('doc'), docId: z.string().min(1), snippet: z.string().min(1).max(500) }),
  /** Code-composed text (the AI disclosure note); never model-written. */
  z.object({ kind: z.literal('disclosure') }),
]);
export type ValueSource = z.infer<typeof valueSourceSchema>;

export const filledFieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string(),
  type: z.string(),
  value: z.union([z.string(), z.boolean()]),
  source: valueSourceSchema,
});
export type FilledField = z.infer<typeof filledFieldSchema>;

export const missingFieldSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string(),
  required: z.boolean(),
  reason: z.enum(['no_consented_source', 'medical_question', 'file_not_ticked', 'needs_patient']),
  /** Plain-language question shown to the patient. */
  question: z.string(),
});
export type MissingField = z.infer<typeof missingFieldSchema>;

export const applicationStatusSchema = z.enum(['draft', 'approved', 'submitting', 'submitted', 'stale', 'refused', 'failed']);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export interface WebApplicationDraft {
  id: string;
  caseId: string;
  contactId: string | null;
  url: string;
  fields: FilledField[];
  missing: MissingField[];
  /** fingerprintFields() of the page as read during FILL. */
  formFingerprint: string;
  /** base64 PNG taken after filling, before any submit. */
  screenshot: string | null;
  /** Case-field keys the patient ticked for this application. */
  sharedFields: string[];
  /** case_documents ids the patient ticked as uploadable. */
  sharedDocIds: string[];
  status: ApplicationStatus;
  approvedAt: string | null;
  submittedAt: string | null;
  result: Record<string, unknown> | null;
  createdAt: string;
}
