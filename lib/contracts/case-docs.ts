import { z } from 'zod';
import { SHARED_FIELDS } from '@/lib/outreach/draft';
import { plainText } from './plain-text';

export const documentKindSchema = z.enum(['intake_report', 'case_summary', 'resource_page', 'evidence', 'inbound_message', 'call_transcript', 'patient_note', 'medical_record']);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const patientNoteSchema = z.object({
  title: plainText().pipe(z.string().min(1).max(200)),
  text: plainText().pipe(z.string().min(1).max(20_000)),
  sharedField: z.enum(SHARED_FIELDS),
}).strict();
