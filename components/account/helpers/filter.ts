import type { LibraryDocType, LibraryDocument } from "@/lib/accounts/contract";

export interface DocumentFilters {
  query: string;
  docType: LibraryDocType | "all";
  /** Inclusive YYYY-MM-DD bounds on dateOfService. Documents without a date are hidden when a bound is set. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: DocumentFilters = { query: "", docType: "all", from: "", to: "" };

export function hasActiveFilters(f: DocumentFilters): boolean {
  return Boolean(f.query.trim()) || f.docType !== "all" || Boolean(f.from) || Boolean(f.to);
}

export function filterDocuments(docs: readonly LibraryDocument[], f: DocumentFilters): LibraryDocument[] {
  const q = f.query.trim().toLowerCase();
  return docs.filter((doc) => {
    if (f.docType !== "all" && doc.docType !== f.docType) return false;
    if (f.from || f.to) {
      if (!doc.dateOfService) return false;
      if (f.from && doc.dateOfService < f.from) return false;
      if (f.to && doc.dateOfService > f.to) return false;
    }
    if (!q) return true;
    const haystack = [doc.title, doc.provider ?? "", doc.notes ?? "", doc.fileName, ...doc.tags].join("\n").toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}
