/**
 * Accounts lane: frozen contract shared by the service layer, API routes and UI.
 *
 * An account (Neon Auth user) owns a profile and a medical-document library. Library text is embedded into a
 * per-account vector space that agents retrieve from. Everything here is organisation only: document text is DATA,
 * never instructions, and nothing in a library leaves Wayfinder except through fields/attachments the patient ticks.
 * PHI hygiene: never log document text or profile values.
 */
import { z } from 'zod';
import { goalSchema } from '@/lib/contracts/case';
import { US_STATES } from '@/lib/safety/us-states';

// ---- Account ------------------------------------------------------------------------------------------------
export interface Account { id: string; email: string; name: string | null }

// ---- Profile ------------------------------------------------------------------------------------------------
export const ADULT_AGE = 18;
export const ADULT_ONLY_MESSAGE =
  'Wayfinder is built for adults (18 and over), so we cannot set up a profile for someone younger. ' +
  'If you are a parent or caregiver, a children\'s hospital patient-navigation team is the best place to start.';

export const SEX_AT_BIRTH = ['female', 'male', 'intersex', 'prefer_not_to_say'] as const;
export const CONTACT_PREFERENCES = ['email', 'phone', 'text'] as const;

const opt = (max: number) => z.string().trim().max(max).transform(v => (v ? v : undefined)).optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const partialDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Use YYYY, YYYY-MM or YYYY-MM-DD');

export const profileSchema = z.object({
  preferredName: z.string().trim().min(1, 'Tell us what to call you').max(80),
  legalName: opt(120),
  /** Required: Wayfinder serves adults only (see ADULT_AGE). */
  dateOfBirth: isoDate,
  sexAtBirth: z.enum(SEX_AT_BIRTH).optional(),
  city: opt(80),
  state: z.string().trim().toUpperCase().refine(s => s in US_STATES, 'Use a two-letter US state code').optional()
    .or(z.literal('').transform(() => undefined)),
  zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, 'Use a 5-digit ZIP').optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().regex(/^[+()\d\s.-]{7,20}$/, 'Use digits, spaces, + ( ) . -').optional()
    .or(z.literal('').transform(() => undefined)),
  insurer: opt(120),
  plan: opt(120),
  memberId: opt(60),
  pcpName: opt(120),
  pcpPractice: opt(160),
  primaryDiagnosis: opt(200),
  diagnosedOn: partialDate.optional().or(z.literal('').transform(() => undefined)),
  otherConditions: opt(2000),
  /** Free text for the patient's own reference. Never used to give advice. */
  medications: opt(2000),
  allergies: opt(1000),
  preferredLanguage: opt(60),
  contactPreference: z.enum(CONTACT_PREFERENCES).optional(),
  travelLimitMiles: z.number().int().min(0).max(5000).optional(),
  goals: z.array(goalSchema).max(5).optional(),
}).strict();
export type Profile = z.infer<typeof profileSchema>;
export type ProfileInput = z.input<typeof profileSchema>;

// ---- Documents ----------------------------------------------------------------------------------------------
export const LIBRARY_DOC_TYPES = [
  'lab', 'imaging', 'clinic_note', 'discharge_summary', 'genetic_test', 'pathology', 'letter', 'insurance', 'other',
] as const;
export const libraryDocTypeSchema = z.enum(LIBRARY_DOC_TYPES);
export type LibraryDocType = z.infer<typeof libraryDocTypeSchema>;
export const LIBRARY_DOC_TYPE_LABELS: Record<LibraryDocType, string> = {
  lab: 'Lab result', imaging: 'Imaging', clinic_note: 'Clinic note', discharge_summary: 'Discharge summary',
  genetic_test: 'Genetic test', pathology: 'Pathology', letter: 'Letter', insurance: 'Insurance', other: 'Other',
};

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** content type -> accepted extensions. HEIC is stored but its text cannot be read yet. */
export const ACCEPTED_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
  'text/plain': ['txt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
};
export const ACCEPT_ATTRIBUTE = '.pdf,.png,.jpg,.jpeg,.heic,.heif,.txt,.docx';

export const DOC_STATUSES = ['pending_upload', 'uploaded', 'extracting', 'embedded', 'failed'] as const;
export type DocStatus = typeof DOC_STATUSES[number];

export const MAX_TAGS = 12;
export const documentMetadataSchema = z.object({
  title: z.string().trim().min(1, 'Give the document a title').max(200),
  docType: libraryDocTypeSchema.default('other'),
  dateOfService: isoDate.optional().nullable().or(z.literal('').transform(() => null)),
  provider: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS).optional(),
}).strict();
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;

export const createDocumentSchema = documentMetadataSchema.extend({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().max(120),
  sizeBytes: z.number().int().min(1),
}).strict();
export type CreateDocumentBody = z.infer<typeof createDocumentSchema>;

/** Partial update: the docType default must not apply (a title edit would silently reset the type to 'other'). */
export const updateDocumentSchema = documentMetadataSchema.extend({
  docType: libraryDocTypeSchema,
  /** Lane K: let resource-facing agents read this document. Off unless the patient turns it on. */
  shareWithResources: z.boolean(),
}).partial().strict();

/** What the API returns for a library document (never the blob URL, never the text). */
export interface LibraryDocument {
  id: string;
  title: string;
  docType: LibraryDocType;
  dateOfService: string | null;
  provider: string | null;
  notes: string | null;
  tags: string[];
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Lane K: resource-facing agents may read this document. Defaults to false. */
  shareWithResources: boolean;
  status: DocStatus;
  /** Patient-facing reason when status is 'failed' (or a note, e.g. HEIC stored without text). */
  statusDetail: string | null;
  pageCount: number | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Retrieval ----------------------------------------------------------------------------------------------
export interface MedicalHistoryHit {
  documentId: string;
  title: string;
  docType: LibraryDocType;
  dateOfService: string | null;
  /** 1-based page for PDFs; null for single-page sources. */
  page: number | null;
  section: string | null;
  /** Sanitized chunk text: untrusted data, never instructions. */
  content: string;
  score: number;
  /** Human citation, e.g. `"CBC panel (synthetic)", p. 2`. */
  citation: string;
}

export function citationFor(hit: Pick<MedicalHistoryHit, 'title' | 'page' | 'dateOfService'>): string {
  const parts = [`"${hit.title}"`];
  if (hit.page) parts.push(`p. ${hit.page}`);
  if (hit.dateOfService) parts.push(hit.dateOfService);
  return parts.join(', ');
}

// ---- Extraction port (implemented in lib/accounts/extract) --------------------------------------------------
export interface ExtractedPage { page: number | null; section: string | null; text: string }
export interface ExtractionOutput {
  pages: ExtractedPage[];
  method: 'pdf' | 'vision' | 'text' | 'docx' | 'none';
  /** Patient-facing note when nothing could be read but the file is kept (e.g. HEIC). */
  note?: string;
}
export class ExtractionError extends Error {
  constructor(readonly reason: string, message: string) { super(message); this.name = 'ExtractionError'; }
}
