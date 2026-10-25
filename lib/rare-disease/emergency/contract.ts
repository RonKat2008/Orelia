/**
 * Emergency information card: a printable sheet the patient shows emergency staff. Every line comes from a cited
 * source (sourced condition facts, the patient's own records) or from the patient (contacts, care team). It is never
 * advice to the patient, and it is only printable, saveable or shareable after the patient approves it.
 * Safe to import from client components (no node: imports here).
 */
import { z } from 'zod';
import type { CareNeeds } from '@/lib/contracts/care-needs';

export const EMERGENCY_HEADER = 'Information to show emergency staff. Not medical advice. Confirm with your care team.';
/** coordination_records kind for the per-case card record. */
export const EMERGENCY_KIND = 'emergency_card';
export const EMERGENCY_KEY = 'current';
export const MAX_CONTACTS = 4;
export const MAX_CARE_TEAM = 6;
export const SHARE_DAYS = 30;

/** Plain text only: no markup characters, no control characters. */
const plain = (max: number) => z.string().trim().min(1).max(max)
  .refine((s) => !/[<>{}\\`]/.test(s) && !/[\u0000-\u001f\u007f]/.test(s), { message: 'Use plain text only' });
const phone = z.string().trim().min(3).max(32)
  .regex(/^[0-9+()\-.\s]+$/, { message: 'Use numbers only' })
  .refine((s) => s.replace(/\D/g, '').length >= 7 && s.replace(/\D/g, '').length <= 15, { message: 'Enter a full phone number' });

export const emergencyContactSchema = z.strictObject({ name: plain(80), relationship: plain(60), phone });
export const careTeamMemberSchema = z.strictObject({ name: plain(80), role: plain(80), phone });
export const cardInputsSchema = z.strictObject({
  contacts: z.array(emergencyContactSchema).max(MAX_CONTACTS),
  careTeam: z.array(careTeamMemberSchema).max(MAX_CARE_TEAM),
});
export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
export type CareTeamMember = z.infer<typeof careTeamMemberSchema>;
export type CardInputs = z.infer<typeof cardInputsSchema>;

const factSourceSchema = z.strictObject({ url: z.url(), title: z.string().max(400), short: z.string().max(60) });
export const factLineSchema = z.strictObject({ id: z.string().max(80), text: z.string().max(300), sources: z.array(factSourceSchema).min(1).max(6) });
export const recordLineSchema = z.strictObject({
  id: z.string().max(100),
  kind: z.enum(['diagnosis', 'genetic_test']),
  title: z.string().max(200),
  findings: z.array(z.string().max(400)).max(20),
  docTitle: z.string().max(200),
  date: z.string().max(10).nullable(),
});
export type FactLine = z.infer<typeof factLineSchema>;
export type RecordLine = z.infer<typeof recordLineSchema>;

/** The printable content. Hashing this is what the patient approves. */
export const cardContentSchema = z.strictObject({
  header: z.literal(EMERGENCY_HEADER),
  facts: z.array(factLineSchema),
  records: z.array(recordLineSchema),
  contacts: z.array(emergencyContactSchema),
  careTeam: z.array(careTeamMemberSchema),
});
export type CardContent = z.infer<typeof cardContentSchema>;

export const DROP_REASONS = ['instruction', 'medical_advice', 'unsourced', 'diagnosis_guess'] as const;
export type DropReason = (typeof DROP_REASONS)[number];
export interface DroppedLine {
  id: string;
  section: 'facts' | 'records' | 'contacts' | 'careTeam';
  text: string;
  reason: DropReason;
}

export const approvalSchema = z.strictObject({ approvedAt: z.iso.datetime(), contentHash: z.string().min(8).max(128), version: z.number().int().min(1) });
export const snapshotSchema = z.strictObject({ content: cardContentSchema, contentHash: z.string().min(8).max(128), approvedAt: z.iso.datetime() });
export const shareInfoSchema = z.strictObject({
  id: z.string().min(1).max(100), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), revokedAt: z.iso.datetime().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;
export type ApprovedSnapshot = z.infer<typeof snapshotSchema>;
export type ShareInfo = z.infer<typeof shareInfoSchema>;

/** Stored per case in coordination_records (kind emergency_card). `version` counts input edits. */
export const emergencyRecordSchema = z.strictObject({
  version: z.number().int().min(1),
  inputs: cardInputsSchema,
  approval: approvalSchema.nullable(),
  snapshot: snapshotSchema.nullable(),
  share: shareInfoSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type EmergencyRecord = z.infer<typeof emergencyRecordSchema>;

export type ApprovalState = 'needs_approval' | 'approved' | 'changed';
export type ShareStatus = 'active' | 'expired' | 'revoked';

/** The slice of CareNeeds the card reads. */
export type NeedsForCard = Pick<CareNeeds, 'emergencyFacts' | 'sources'>;

/** Body schemas for the routes. */
export const putBodySchema = z.strictObject({ inputs: cardInputsSchema });
export const approveBodySchema = z.strictObject({ version: z.number().int().min(1), contentHash: z.string().min(1).max(128) });

/** What GET /api/cases/[id]/emergency returns (the owner's view). */
export interface EmergencyView {
  card: CardContent;
  dropped: DroppedLine[];
  state: ApprovalState;
  version: number;
  contentHash: string;
  inputs: CardInputs;
  approvedAt: string | null;
  snapshot: ApprovedSnapshot | null;
  share: { status: ShareStatus; expiresAt: string } | null;
  undiagnosed: boolean;
}
