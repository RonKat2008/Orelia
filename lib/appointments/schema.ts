import { z } from 'zod';

export const APPOINTMENT_KINDS = ['appointment', 'consult', 'screening_interview', 'intake_call', 'telehealth', 'test', 'other'] as const;
export const APPOINTMENT_STATUSES = ['proposed', 'confirmed', 'rescheduled', 'cancelled', 'done'] as const;
export const APPOINTMENT_SOURCES = ['reply', 'manual', 'call_transcript'] as const;

export const appointmentKindSchema = z.enum(APPOINTMENT_KINDS);
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export const appointmentSourceSchema = z.enum(APPOINTMENT_SOURCES);

export type AppointmentKind = z.infer<typeof appointmentKindSchema>;
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type AppointmentSource = z.infer<typeof appointmentSourceSchema>;

export const KIND_LABELS: Record<AppointmentKind, string> = {
  appointment: 'Appointment',
  consult: 'Consult',
  screening_interview: 'Screening interview',
  intake_call: 'Intake call',
  telehealth: 'Telehealth visit',
  test: 'Test or scan',
  other: 'Other',
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  proposed: 'Proposed time',
  confirmed: 'Confirmed',
  rescheduled: 'Being rescheduled',
  cancelled: 'Cancelled',
  done: 'Done',
};

/** One candidate time found in a reply. Instants are ISO UTC; the wall time is shown in `timezone`. */
export const candidateSlotSchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The literal text the time came from (sanitized). */
  text: z.string().max(200),
  /** The reply named a weekday that does not match the date (e.g. "Tuesday Nov 11"). */
  weekdayMismatch: z.boolean().default(false),
});
export type CandidateSlot = z.infer<typeof candidateSlotSchema>;

export const prepNotesSchema = z.object({
  /** Checklist item id -> ticked. Items come from lib/appointments/prep.ts. */
  checked: z.record(z.string().max(40), z.boolean()).default({}),
  /** The patient's own questions for the visit (their words; never generated). */
  questions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  /** Free-form note by the patient. */
  note: z.string().max(2000).default(''),
});
export type PrepNotes = z.infer<typeof prepNotesSchema>;

export interface Appointment {
  id: string;
  caseId: string;
  ownerKey: string | null;
  contactId: string | null;
  kind: AppointmentKind;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string;
  location: string | null;
  telehealthUrl: string | null;
  phone: string | null;
  withWhom: string | null;
  status: AppointmentStatus;
  source: AppointmentSource;
  sourceMessageId: string | null;
  candidates: CandidateSlot[];
  quote: string | null;
  prepNotes: PrepNotes;
  reminders: number[];
  remindedAt: string | null;
  googleEventId: string | null;
  requestMessageId: string | null;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_REMINDERS = [1440, 120] as const;
export const DEFAULT_DURATION_MINUTES = 60;

const httpsUrl = z.url().max(500).refine(u => u.startsWith('https://'), 'Telehealth links must use https');
const tz = z.string().max(64).refine(isValidTimeZone, 'Unknown time zone');

export function isValidTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/** Patient-entered appointment (manual add or edit). */
export const appointmentInputSchema = z.object({
  kind: appointmentKindSchema,
  title: z.string().trim().min(1).max(160),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().optional(),
  timezone: tz,
  location: z.string().trim().max(300).optional(),
  telehealthUrl: httpsUrl.optional(),
  phone: z.string().trim().max(40).optional(),
  withWhom: z.string().trim().max(160).optional(),
  contactId: z.uuid().optional(),
}).strict().refine(v => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), { message: 'End must be after start', path: ['endsAt'] });
export type AppointmentInput = z.infer<typeof appointmentInputSchema>;

export const confirmInputSchema = z.object({
  /** Index into candidates; or an explicit corrected time. */
  candidate: z.number().int().min(0).max(9).optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  kind: appointmentKindSchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
  location: z.string().trim().max(300).optional(),
  telehealthUrl: httpsUrl.optional(),
  timezone: tz.optional(),
}).strict().refine(v => v.candidate !== undefined || v.startsAt !== undefined, { message: 'Pick a time', path: ['candidate'] });
export type ConfirmInput = z.infer<typeof confirmInputSchema>;
