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
  intake_report: "Intake report",
  patient_note: "Notes you added",
  public_resource: "Public resource info",
  evidence: "Sources research found",
};

/** "disease_program" -> "Disease program". */
export function humanizeTitle(title: string): string {
  const spaced = title.replaceAll("_", " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : title;
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
    if (response.status === 404) {
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
    return { status: "ready", documents: previewDocuments, preview: true };
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
    if (response.status !== 404) return { error: "The note was not saved." };
  } catch {
    // API from task 25 may not be mounted yet.
  }
  return {
    document: noteToDocument(note, `note-local-${Date.now()}`),
    preview: true,
  };
}
