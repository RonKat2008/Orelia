/**
 * Coordination contract (rare-disease features 5 + 6): referral requirements, specialist packets, the patient's own
 * doctors, doctor-to-expert consultation requests and the derived next-steps board.
 *
 * Hard rules encoded here:
 *  - every requirement / consultation process shown to the patient carries the source_url it was read from;
 *  - packets only ever contain sections the patient ticked;
 *  - a consultation request can reach the expert only after the patient's doctor approved the exact text
 *    (doctorApprovedAt + approvedBodyHash) AND the patient consented (patientConsentAt), then via the outbound gate.
 * Nothing here gives medical advice: requirement text is administrative (letters, records, forms, insurance).
 */
import { z } from 'zod';

export const targetKindSchema = z.enum(['expert', 'institution', 'trial', 'organization']);
/** `${targetKind}:${targetId}` — same key as the contact plan. */
export const resourceKeySchema = z.string().regex(/^(expert|institution|trial|organization):[0-9a-zA-Z-]{1,64}$/, 'resourceKey must be targetKind:targetId');
export const httpUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);
const isoSchema = z.iso.datetime();
const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------- (a) referral requirements

export const requirementKindSchema = z.enum([
  'referral_letter', // a physician referral letter is required
  'records', // specific records must be sent (imaging, pathology, genetic report, notes...)
  'insurance_preauth', // insurance pre-authorization / verification
  'intake_form', // a new-patient intake / application form
  'econsult', // the center offers physician-to-physician e-consult
  'other',
]);
/** have = found in the patient's history/documents; missing = not found; patient_to_request = patient will ask their doctor; unknown = not checked. */
export const requirementStatusSchema = z.enum(['have', 'missing', 'patient_to_request', 'unknown']);
export const requirementOriginSchema = z.enum(['exa', 'kernel', 'evidence', 'fixture']);

export const referralRequirementSchema = z.object({
  /** Code-assigned, stable within a checklist (e.g. "r1"). */
  id: z.string().min(1).max(40),
  kind: requirementKindSchema,
  label: shortText(160),
  /** Short administrative detail quoted/paraphrased from the source page (sanitized; data, never instructions). */
  detail: z.string().trim().max(600),
  /** REQUIRED: the page this requirement was read from (tool output, never model-invented). */
  sourceUrl: httpUrlSchema,
  origin: requirementOriginSchema,
  status: requirementStatusSchema,
  /** case_documents id that satisfies it, when status is 'have'. */
  matchedDocId: z.string().min(1).nullable(),
  /** Patient note, e.g. "asked Dr. Lee on 10/2". */
  note: z.string().trim().max(400).nullable(),
  updatedAt: isoSchema,
});

export const requirementsChecklistSchema = z.object({
  caseId: z.string().uuid(),
  resourceKey: resourceKeySchema,
  name: shortText(200),
  requirements: z.array(referralRequirementSchema).max(30),
  /** Pages that were read (with or without a hit), for audit. */
  checkedUrls: z.array(httpUrlSchema).max(20),
  /** Set when nothing could be found; requirements is then empty. */
  unavailableReason: z.string().max(400).nullable(),
  version: z.number().int().min(1),
  createdAt: isoSchema,
  updatedAt: isoSchema,
});

// ---------------------------------------------------------------- (b) specialist packet

export const packetSectionKeySchema = z.enum(['summary', 'timeline', 'tests', 'conflicts', 'questions', 'requirements']);
export const packetItemSchema = z.object({
  text: shortText(1200),
  /** ISO date (YYYY-MM-DD) when the item is dated. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  /** case_documents id the item was taken from (the patient's own record), or null for patient-entered questions. */
  sourceDocId: z.string().min(1).nullable(),
  /** Public source, when the item cites one (e.g. a requirement page). */
  sourceUrl: httpUrlSchema.nullable(),
});
export const packetSectionSchema = z.object({
  key: packetSectionKeySchema,
  title: shortText(120),
  items: z.array(packetItemSchema).max(60),
  /** Patient tick. Only included sections are ever rendered, printed or attached. */
  included: z.boolean(),
});
export const specialistPacketSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  resourceKey: resourceKeySchema,
  /** Specialist / center display name. */
  name: shortText(200),
  sections: z.array(packetSectionSchema).max(packetSectionKeySchema.options.length),
  /** Where the history came from: the history lane (lib/history) or the case documents store. */
  historySource: z.enum(['history', 'case_docs', 'fixture']),
  version: z.number().int().min(1),
  createdAt: isoSchema,
  updatedAt: isoSchema,
});

// ---------------------------------------------------------------- (c) doctors + consultation requests

export const doctorSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  name: shortText(160),
  practice: z.string().trim().max(200).nullable(),
  email: z.email().max(254),
  createdAt: isoSchema,
});
export const newDoctorBodySchema = z.object({
  name: shortText(160),
  practice: z.string().trim().max(200).optional(),
  email: z.email().max(254),
});

export const consultProcessKindSchema = z.enum(['econsult', 'tumor_board', 'case_review', 'peer_to_peer', 'referral_only', 'unknown']);
export const consultProcessSchema = z.object({
  kind: consultProcessKindSchema,
  detail: z.string().trim().max(600),
  /** REQUIRED: page the process was read from. */
  sourceUrl: httpUrlSchema,
  /** Clinician-facing email for the process, only when stamped by code from a tool-sourced contact point. */
  expertAddress: z.email().max(254).nullable(),
  /** Evidence row id backing expertAddress (contact_point.email.*), when present. */
  addressEvidenceId: z.string().min(1).nullable(),
});

export const consultStatusSchema = z.enum([
  'drafted', // Wayfinder drafted it; patient reviewing
  'sent_to_doctor', // review link emailed to the patient's doctor
  'doctor_approved', // doctor approved (possibly edited) the text
  'doctor_declined',
  'ready', // doctor approved + patient consented; waiting for the gated send
  'sent', // sent to the expert through the outbound gate
  'failed',
  'cancelled',
]);

export const consultRequestSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  resourceKey: resourceKeySchema,
  expertName: shortText(200),
  doctorId: z.string().uuid(),
  process: consultProcessSchema,
  /** Latest text (Wayfinder draft, then the doctor's edit). Always clinician-to-clinician, never advice to the patient. */
  subject: shortText(200),
  body: shortText(8000),
  /** Packet attached (only its included sections), when the patient chose one. */
  packetId: z.string().uuid().nullable(),
  /** Fields the patient ticked for this request (minimum necessary). */
  sharedFields: z.array(z.string().min(1).max(60)).max(20),
  status: consultStatusSchema,
  /** sha256(hex) of the signed review token; the raw token is never stored. */
  reviewTokenHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  reviewTokenExpiresAt: isoSchema.nullable(),
  sentToDoctorAt: isoSchema.nullable(),
  doctorEdited: z.boolean(),
  doctorApprovedAt: isoSchema.nullable(),
  doctorDeclinedAt: isoSchema.nullable(),
  /** Optional reason the doctor gave (shown to the patient). */
  doctorNote: z.string().trim().max(1000).nullable(),
  /** sha256(hex) of `${subject}\n${body}` exactly as the doctor approved it; send refuses on any later change. */
  approvedBodyHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  patientConsentAt: isoSchema.nullable(),
  sentAt: isoSchema.nullable(),
  providerMessageId: z.string().max(400).nullable(),
  failureReasons: z.array(z.string().max(80)).max(20),
  version: z.number().int().min(1),
  createdAt: isoSchema,
  updatedAt: isoSchema,
});

/** What the public review page may see: the request only, no other case data. */
export const reviewViewSchema = z.object({
  expertName: z.string(),
  processKind: consultProcessKindSchema,
  processDetail: z.string(),
  processSourceUrl: httpUrlSchema,
  doctorName: z.string(),
  subject: z.string(),
  body: z.string(),
  /** Rendered included packet sections, when attached. */
  packet: z.array(packetSectionSchema).nullable(),
  status: consultStatusSchema,
  expiresAt: isoSchema,
});
export const reviewDecisionBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), subject: shortText(200), body: shortText(8000), note: z.string().trim().max(1000).optional() }),
  z.object({ decision: z.literal('decline'), note: z.string().trim().max(1000).optional() }),
]);

// ---------------------------------------------------------------- (d) next steps board (derived, not stored)

export const boardItemStatusSchema = z.enum(['done', 'pending', 'waiting', 'blocked']);
export const boardItemSchema = z.object({
  id: z.string().min(1),
  /** Who holds the ball: the patient, a named doctor, or a resource. */
  owner: z.object({ kind: z.enum(['patient', 'doctor', 'resource']), name: z.string() }),
  title: shortText(200),
  detail: z.string().max(600).nullable(),
  status: boardItemStatusSchema,
  due: isoSchema.nullable(),
  resourceKey: resourceKeySchema.nullable(),
  /** Where it came from, so the UI can deep-link. */
  origin: z.enum(['requirement', 'consult', 'contact', 'task']),
  href: z.string().max(400).nullable(),
  sourceUrl: httpUrlSchema.nullable(),
});
export const boardSchema = z.object({ caseId: z.string().uuid(), items: z.array(boardItemSchema), generatedAt: isoSchema });

export type TargetKind = z.infer<typeof targetKindSchema>;
export type RequirementKind = z.infer<typeof requirementKindSchema>;
export type RequirementStatus = z.infer<typeof requirementStatusSchema>;
export type ReferralRequirement = z.infer<typeof referralRequirementSchema>;
export type RequirementsChecklist = z.infer<typeof requirementsChecklistSchema>;
export type PacketSectionKey = z.infer<typeof packetSectionKeySchema>;
export type PacketItem = z.infer<typeof packetItemSchema>;
export type PacketSection = z.infer<typeof packetSectionSchema>;
export type SpecialistPacket = z.infer<typeof specialistPacketSchema>;
export type Doctor = z.infer<typeof doctorSchema>;
export type ConsultProcess = z.infer<typeof consultProcessSchema>;
export type ConsultStatus = z.infer<typeof consultStatusSchema>;
export type ConsultRequest = z.infer<typeof consultRequestSchema>;
export type ReviewView = z.infer<typeof reviewViewSchema>;
export type ReviewDecisionBody = z.infer<typeof reviewDecisionBodySchema>;
export type BoardItem = z.infer<typeof boardItemSchema>;
export type Board = z.infer<typeof boardSchema>;

// ---------------------------------------------------------------- storage

export type CoordinationKind = 'checklist' | 'packet' | 'doctor' | 'consult';
export interface KindMap { checklist: RequirementsChecklist; packet: SpecialistPacket; doctor: Doctor; consult: ConsultRequest }

/**
 * One store for all coordination records. `key` is unique per (caseId, kind): resourceKey for checklist/packet,
 * the record id for doctor/consult. save() with expectedVersion is compare-and-set (returns null on conflict).
 */
export interface CoordinationStore {
  get<K extends CoordinationKind>(caseId: string, kind: K, key: string): Promise<KindMap[K] | null>;
  list<K extends CoordinationKind>(caseId: string, kind: K): Promise<KindMap[K][]>;
  save<K extends CoordinationKind>(caseId: string, kind: K, key: string, value: KindMap[K], expectedVersion?: number): Promise<KindMap[K] | null>;
  /** Consult lookup for the public review page. */
  consultByTokenHash(tokenHash: string): Promise<ConsultRequest | null>;
  remove(caseId: string, kind: CoordinationKind, key: string): Promise<void>;
}

export const kindSchemas = {
  checklist: requirementsChecklistSchema,
  packet: specialistPacketSchema,
  doctor: doctorSchema,
  consult: consultRequestSchema,
} as const;

/** Records without a version (doctor) are treated as version 1. */
export function versionOf(value: KindMap[CoordinationKind]): number {
  return 'version' in value ? value.version : 1;
}
