/**
 * Medical history lane: frozen contract shared by extraction, storage, routes, share links and UI.
 * Everything here is organisation only. Wayfinder never interprets, resolves or advises on medical content:
 * events quote what a patient's own record says, with a pointer back to the exact span of the source document.
 */
import { z } from 'zod';

export const EVENT_KINDS = [
  'diagnosis', 'genetic_test', 'specialist_visit', 'imaging', 'lab', 'procedure', 'medication', 'hospitalization', 'note',
] as const;
export const eventKindSchema = z.enum(EVENT_KINDS);
export type EventKind = z.infer<typeof eventKindSchema>;

/** Patient-facing labels (plural for filter chips / summary sections). */
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  diagnosis: 'Diagnoses', genetic_test: 'Genetic tests', specialist_visit: 'Specialist visits', imaging: 'Imaging',
  lab: 'Labs', procedure: 'Procedures', medication: 'Medications', hospitalization: 'Hospital stays', note: 'Notes',
};

export const DOC_TYPES = ['visit_note', 'genetic_report', 'imaging_report', 'lab_report', 'letter', 'discharge_summary', 'other'] as const;
export const docTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof docTypeSchema>;

export const MAX_RECORD_CHARS = 60_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_DOCUMENTS_PER_CASE = 50;

/** Character offsets [start, end) into HistoryDocument.text (the sanitized text that was stored). */
export const spanSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) })
  .refine(s => s.end > s.start, 'span end must be after start');
export type Span = z.infer<typeof spanSchema>;

/** ISO date with the precision the record gave: YYYY, YYYY-MM or YYYY-MM-DD. */
export const partialDateSchema = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/);

export const historyEventSchema = z.object({
  id: z.string().min(1).max(100),
  /** null when the record gives no usable date; such events sort last. */
  date: partialDateSchema.nullable(),
  kind: eventKindSchema,
  title: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable(),
  institution: z.string().trim().max(200).nullable(),
  /** Short verbatim-ish statements from the record (each must be grounded in the source span). */
  findings: z.array(z.string().trim().min(1).max(400)).max(20),
  sourceDocId: z.string().min(1),
  span: spanSchema,
}).strict();
export type HistoryEvent = z.infer<typeof historyEventSchema>;

export const historyDocumentSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  docType: docTypeSchema,
  /** Sanitized text (untrusted data, never instructions). Spans index into this. */
  text: z.string().max(MAX_RECORD_CHARS),
  createdAt: z.string(),
  extractedBy: z.enum(['rules', 'llm']),
}).strict();
export type HistoryDocument = z.infer<typeof historyDocumentSchema>;

export const CONFLICT_KINDS = ['diagnosis', 'variant_classification', 'medication', 'other'] as const;
export const conflictSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(CONFLICT_KINDS),
  /** Neutral topic, e.g. "COL3A1 c.2357G>A classification". */
  topic: z.string().min(1).max(200),
  /** Each statement quotes one record; at least two distinct source documents. */
  statements: z.array(z.object({
    eventId: z.string(), sourceDocId: z.string(), docTitle: z.string(), date: partialDateSchema.nullable(), text: z.string().max(400),
  })).min(2),
  /** Always a neutral prompt to discuss with a clinician; never a resolution. */
  note: z.string().min(1).max(400),
}).strict();
export type Conflict = z.infer<typeof conflictSchema>;

export const CONFLICT_NOTE = 'These records say different things. Wayfinder does not decide which is right — bring both to your doctor to discuss.';

export interface HistoryTimeline {
  documents: Omit<HistoryDocument, 'text'>[];
  /** Sorted by date ascending; undated last. */
  events: HistoryEvent[];
  conflicts: Conflict[];
}

/** Extraction result for one document (before ids are final the doc id is already assigned). */
export interface ExtractionResult { events: HistoryEvent[]; extractedBy: 'rules' | 'llm' }

/** Storage port (Memory + Postgres implementations in lib/history/store.ts). */
export interface HistoryStore {
  addDocument(doc: HistoryDocument, events: HistoryEvent[]): Promise<void>;
  listDocuments(caseId: string): Promise<HistoryDocument[]>;
  listEvents(caseId: string): Promise<HistoryEvent[]>;
  getDocument(caseId: string, docId: string): Promise<HistoryDocument | undefined>;
  /** Removes the document and its events. Returns false if not found for this case. */
  deleteDocument(caseId: string, docId: string): Promise<boolean>;
}

// ---- Share links -------------------------------------------------------------------------------------------
export const SHARE_SECTIONS = [...EVENT_KINDS, 'conflicts'] as const;
export const shareSectionSchema = z.enum(SHARE_SECTIONS);
export type ShareSection = z.infer<typeof shareSectionSchema>;
export const SHARE_MAX_DAYS = 30;

export const createShareBodySchema = z.object({
  sections: z.array(shareSectionSchema).min(1).max(SHARE_SECTIONS.length),
  expiresInDays: z.number().int().min(1).max(SHARE_MAX_DAYS),
  /** Optional label the patient sees in their list, e.g. "Dr. Lee, genetics". */
  label: z.string().trim().max(100).optional(),
}).strict();
export type CreateShareBody = z.infer<typeof createShareBodySchema>;

export interface HistoryShare {
  id: string; caseId: string; sections: ShareSection[]; label: string | null;
  createdAt: string; expiresAt: string; revokedAt: string | null;
}
export interface ShareStore {
  create(share: HistoryShare): Promise<void>;
  get(id: string): Promise<HistoryShare | undefined>;
  list(caseId: string): Promise<HistoryShare[]>;
  /** Sets revokedAt if the share belongs to caseId. Returns the updated share or undefined. */
  revoke(caseId: string, id: string, at: Date): Promise<HistoryShare | undefined>;
}

// ---- Summary (print page + share page) ---------------------------------------------------------------------
export interface SummarySection { key: ShareSection; label: string; events: HistoryEvent[]; conflicts?: Conflict[] }
export interface HistorySummary {
  generatedAt: string;
  /** Document titles cited by the included events (source list). */
  sources: { id: string; title: string; docType: DocType }[];
  sections: SummarySection[];
  disclaimer: string;
}
export const SUMMARY_DISCLAIMER = 'Organised by Wayfinder from the patient\'s own records. Not a medical interpretation; each line cites the record it came from.';

// ---- Search ------------------------------------------------------------------------------------------------
export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(200), k: z.coerce.number().int().min(1).max(50).optional() });
export interface HistorySearchHit {
  sourceDocId: string; docTitle: string; eventId: string | null; kind: EventKind | null; date: string | null;
  snippet: string; score: number; match: 'keyword' | 'semantic' | 'both';
}

// ---- API bodies --------------------------------------------------------------------------------------------
export const addRecordBodySchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  text: z.string().trim().min(1).max(MAX_RECORD_CHARS),
  docType: docTypeSchema.optional(),
}).strict();
export type AddRecordBody = z.infer<typeof addRecordBodySchema>;

/** case-docs field tag for history chunks. Not in SHARED_FIELDS, so outreach search never sees it unless a
 * consent flow explicitly passes it in allowedFields. */
export const HISTORY_DOC_FIELD = 'medicalHistory';
