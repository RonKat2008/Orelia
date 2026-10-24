import { z } from 'zod';

/** What a reply or call transcript asks the patient to do next. */
export const inboxClassSchema = z.enum([
  'needs_referral', 'send_slides', 'send_records', 'call_to_schedule', 'redirect', 'declined', 'unclear',
]);

/**
 * Classifier output (Opus via runAgent, or offline fixtures). Extracted fields must be quoted from the
 * message; the model never invents a contact, number or hours.
 */
export const inboxClassificationSchema = z.object({
  class: inboxClassSchema,
  confidence: z.number().min(0).max(1),
  /** One-line, non-clinical reason shown to the patient. */
  rationale: z.string().min(1).max(300),
  /** Verbatim snippet from the message that supports the class. */
  quote: z.string().max(500).optional(),
  phone: z.string().optional(),
  hours: z.string().optional(),
  /** Things the callee said to have ready (insurance card, referral, MRN, ...). */
  haveReady: z.array(z.string()).max(10).optional(),
  redirect: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    department: z.string().optional(),
  }).optional(),
  /** Lab/pathology details for slide requests, when stated. */
  lab: z.object({ name: z.string().optional(), accession: z.string().optional() }).optional(),
});

export type InboxClass = z.infer<typeof inboxClassSchema>;
export type InboxClassification = z.infer<typeof inboxClassificationSchema>;
