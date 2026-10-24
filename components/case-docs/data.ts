import { z } from "zod";

export const caseDocumentSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  sharedField: z.string().nullable(),
  contactId: z.string().nullable(),
  createdAt: z.string().min(1),
});

export type CaseDocument = z.infer<typeof caseDocumentSchema>;

export const documentsResponseSchema = z.object({
  documents: z.array(caseDocumentSchema),
});

const noteInputSchema = z.object({
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
  sharedField: z.string().trim().optional(),
});

export type NoteInput = z.infer<typeof noteInputSchema>;

export const KIND_LABELS: Record<string, string> = {
  case_summary: "Facts from your case",
  medical_record: "Records you added",
  intake_report: "Your intake report",
  patient_note: "Notes you added",
  public_resource: "Public resource info",
  evidence: "Sources research found",
};

/** Plain labels for the case fields the intake stores (docs/DESIGN-v2.md 7.12). Keys are the stored field names. */
export const FIELD_LABELS: Record<string, string> = {
  diseaseName: "Your condition",
  subtype: "Your condition type",
  stageSummary: "How far it has gone",
  homeCity: "Your city",
  homeState: "Your state",
  insurer: "Your insurance",
  planId: "Your insurance plan",
  travelLimitMiles: "How far you can travel",
  goals: "What you hope for",
};

/** "HomeCity" / "homeCity" / "home_city" -> lower-first camel key "homeCity" when it is a known field, else null. */
function fieldKey(raw: string): string | null {
  const compact = raw.trim().replace(/[\s_-]+(.)/g, (_, c: string) => c.toUpperCase());
  const key = compact ? compact[0].toLowerCase() + compact.slice(1) : "";
  return key in FIELD_LABELS ? key : null;
}

/** "disease_program" -> "Disease program"; "HomeCity" -> "Your city"; "experts.authorship" -> "Experts authorship". */
export function humanizeTitle(title: string): string {
  title = title.replace(/\s*\([0-9a-f]{8}-[0-9a-f-]{27,}\)\s*$/i, "");
  const key = fieldKey(title);
  if (key) return FIELD_LABELS[key];
  const spaced = title
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : title;
}

/** The label a row shows: the field it shares when it is a case fact, else a plain version of its title. */
export function documentLabel(document: Pick<CaseDocument, "title" | "sharedField">): string {
  const key = document.sharedField ? fieldKey(document.sharedField) : null;
  return key ? FIELD_LABELS[key] : humanizeTitle(document.title);
}

/** Same kind, same label and same shared field are one fact: the store can hold a copy per ingest. */
export function dedupeDocuments(documents: readonly CaseDocument[]): CaseDocument[] {
  const seen = new Map<string, CaseDocument>();
  for (const document of documents) {
    const key = [document.kind, documentLabel(document).toLowerCase(), (document.sharedField ?? "").toLowerCase()].join("|");
    if (!seen.has(key)) seen.set(key, document);
  }
  return [...seen.values()];
}

/** Contacts a duplicate set was tied to ("Shared with: 1 contact"). Counts distinct contact ids across the copies. */
export function sharedContactCount(documents: readonly CaseDocument[], document: CaseDocument): number {
  const label = documentLabel(document).toLowerCase();
  const ids = new Set<string>();
  for (const other of documents) {
    if (other.kind === document.kind && documentLabel(other).toLowerCase() === label && other.contactId) ids.add(other.contactId);
  }
  return ids.size;
}

/** One calm sentence for the row's second line. */
export function plainSharingLine(document: Pick<CaseDocument, "kind" | "sharedField">): string {
  const kind = sharingKind(document);
  if (kind === "never") return "Never sent to anyone";
  if (kind === "consented") return "Only shared when you say yes";
  return "Public information";
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replaceAll("_", " ");
}

/** What an outreach agent is allowed to draw from this document. */
export function sharingLine(
  document: Pick<CaseDocument, "kind" | "sharedField">,
): string {
  if (document.kind === "intake_report" || document.kind === "intake")
    return "Never shared";
  const field = document.sharedField?.trim();
  if (field) return `Shared only with contacts you consent to ${field}`;
  return "Public resource info";
}

export type SharingKind = "never" | "consented" | "public";

/** Same rule as sharingLine, as a value the UI can badge. */
export function sharingKind(
  document: Pick<CaseDocument, "kind" | "sharedField">,
): SharingKind {
  if (document.kind === "intake_report" || document.kind === "intake")
    return "never";
  return document.sharedField?.trim() ? "consented" : "public";
}

export const previewDocuments: CaseDocument[] = [
  {
    id: "doc-intake",
    kind: "intake_report",
    title: "Intake report",
    sharedField: null,
    contactId: null,
    createdAt: "2026-10-23T12:00:00.000Z",
  },
  {
    id: "doc-center",
    kind: "public_resource",
    title: "NCI center listing",
    sharedField: null,
    contactId: null,
    createdAt: "2026-10-23T12:05:00.000Z",
  },
  {
    id: "doc-note",
    kind: "patient_note",
    title: "What I want them to know",
    sharedField: "condition name",
    contactId: null,
    createdAt: "2026-10-23T12:10:00.000Z",
  },
];

export function parseDocuments(value: unknown): CaseDocument[] | null {
  const parsed = documentsResponseSchema.safeParse(value);
  if (parsed.success) return parsed.data.documents;
  const list = z.array(caseDocumentSchema).safeParse(value);
  return list.success ? list.data : null;
}

export function parseNote(value: unknown): NoteInput | null {
  const parsed = noteInputSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function groupDocuments(
  documents: CaseDocument[],
): { kind: string; items: CaseDocument[] }[] {
  const order: string[] = [];
  const groups = new Map<string, CaseDocument[]>();
  for (const document of documents) {
    const list = groups.get(document.kind);
    if (list) list.push(document);
    else {
      order.push(document.kind);
      groups.set(document.kind, [document]);
    }
  }
  return order.map((kind) => ({ kind, items: groups.get(kind) ?? [] }));
}

/** Sample documents only appear when the app is explicitly offline; live cases never fall back silently. */
function offlinePreview(): boolean {
  const raw = process.env.NEXT_PUBLIC_WAYFINDER_OFFLINE ?? "";
  return ["1", "true"].includes(raw.trim().toLowerCase());
}

export type DocumentsLoad =
  | { status: "ready"; documents: CaseDocument[]; preview: boolean }
  | { status: "empty"; preview: boolean }
  | { status: "error"; message: string };

export async function loadDocuments(
  caseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DocumentsLoad> {
  try {
    const response = await fetchImpl(`/api/cases/${caseId}/documents`);
    if (response.status === 404 && offlinePreview()) {
      return previewDocuments.length
        ? { status: "ready", documents: previewDocuments, preview: true }
        : { status: "empty", preview: true };
    }
    if (!response.ok)
      return { status: "error", message: "Documents could not be loaded." };
    const documents = parseDocuments(await response.json());
    if (!documents)
      return {
        status: "error",
        message: "Documents came back in an unexpected shape.",
      };
    if (documents.length === 0) return { status: "empty", preview: false };
    return { status: "ready", documents, preview: false };
  } catch {
    if (offlinePreview()) return { status: "ready", documents: previewDocuments, preview: true };
    return { status: "error", message: "Documents could not be loaded." };
  }
}

export function noteToDocument(note: NoteInput, id: string): CaseDocument {
  return {
    id,
    kind: "patient_note",
    title: note.title,
    sharedField:
      note.sharedField && note.sharedField.length > 0 ? note.sharedField : null,
    contactId: null,
    createdAt: new Date().toISOString(),
  };
}

export async function addPatientNote(
  caseId: string,
  note: NoteInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ document: CaseDocument; preview: boolean } | { error: string }> {
  const body = {
    title: note.title,
    text: note.text,
    sharedField: note.sharedField ?? "",
  };
  try {
    const response = await fetchImpl(`/api/cases/${caseId}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const parsed = caseDocumentSchema.safeParse(await response.json());
      if (parsed.success) return { document: parsed.data, preview: false };
      return {
        document: noteToDocument(note, `note-${Date.now()}`),
        preview: false,
      };
    }
    if (response.status !== 404 || !offlinePreview()) return { error: "The note was not saved." };
  } catch {
    if (!offlinePreview()) return { error: "The note was not saved. Check your connection and try again." };
  }
  return {
    document: noteToDocument(note, `note-local-${Date.now()}`),
    preview: true,
  };
}
