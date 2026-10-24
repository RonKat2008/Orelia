import { z } from 'zod';
import { SHARED_FIELDS } from '@/lib/outreach/draft';

export const documentKindSchema = z.enum(['intake_report', 'case_summary', 'resource_page', 'evidence', 'inbound_message', 'call_transcript', 'patient_note']);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const patientNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(20_000),
  sharedField: z.enum(SHARED_FIELDS),
}).strict();
