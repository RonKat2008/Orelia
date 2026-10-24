import { documentMetadataSchema, type DocumentMetadata, type LibraryDocType, type LibraryDocument } from "@/lib/accounts/contract";
import { parseTags, titleFromFileName } from "./files";

/** Editable form state for a document's metadata (all strings so inputs stay controlled). */
export interface MetadataDraft {
  title: string;
  docType: LibraryDocType;
  dateOfService: string;
  provider: string;
  notes: string;
  tagsText: string;
}

export function draftForFile(fileName: string): MetadataDraft {
  return { title: titleFromFileName(fileName), docType: "other", dateOfService: "", provider: "", notes: "", tagsText: "" };
}

export function draftForDocument(doc: LibraryDocument): MetadataDraft {
  return {
    title: doc.title,
    docType: doc.docType,
    dateOfService: doc.dateOfService ?? "",
    provider: doc.provider ?? "",
    notes: doc.notes ?? "",
    tagsText: doc.tags.join(", "),
  };
}

export type MetadataResult =
  | { ok: true; value: DocumentMetadata }
  | { ok: false; errors: Partial<Record<keyof MetadataDraft, string>> };

const PATH_TO_FIELD: Record<string, keyof MetadataDraft> = {
  title: "title",
  docType: "docType",
  dateOfService: "dateOfService",
  provider: "provider",
  notes: "notes",
  tags: "tagsText",
};

export function metadataFromDraft(draft: MetadataDraft): MetadataResult {
  const parsed = documentMetadataSchema.safeParse({
    title: draft.title,
    docType: draft.docType,
    dateOfService: draft.dateOfService || null,
    provider: draft.provider.trim() || null,
    notes: draft.notes.trim() || null,
    tags: parseTags(draft.tagsText),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<keyof MetadataDraft, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = PATH_TO_FIELD[String(issue.path[0])];
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
