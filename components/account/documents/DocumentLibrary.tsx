"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, SearchX } from "lucide-react";
import type { LibraryDocument } from "@/lib/accounts/contract";
import { EmptyState } from "@/components/ui/display";
import { Skeleton } from "@/components/ui/feedback";
import { List } from "@/components/ui/list-row";
import { LoadingState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { AccountGate } from "../AccountGate";
import { Callout } from "../FormBits";
import { apiRequest } from "../helpers/api";
import { EMPTY_FILTERS, filterDocuments, hasActiveFilters, type DocumentFilters } from "../helpers/filter";
import { DocumentCard } from "./DocumentCard";
import { DeleteDocumentDialog, EditDocumentDialog } from "./DocumentDialogs";
import { LibraryToolbar } from "./LibraryToolbar";
import { UploadPanel } from "./UploadPanel";
import { useUploadQueue } from "./useUploadQueue";

const POLL_MS = 3000;
const PRIVACY =
  "Your documents are private. Wayfinder's agents read them to organise your history and cite them by title; nothing is shared unless you tick it when you contact someone.";

const isPending = (doc: LibraryDocument) => doc.status === "uploaded" || doc.status === "extracting";

function upsert(list: LibraryDocument[], doc: LibraryDocument): LibraryDocument[] {
  return list.some((d) => d.id === doc.id) ? list.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...list];
}

function LibraryBody() {
  const [docs, setDocs] = useState<LibraryDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<DocumentFilters>(EMPTY_FILTERS);
  const [editing, setEditing] = useState<LibraryDocument | null>(null);
  const [deleting, setDeleting] = useState<LibraryDocument | null>(null);
  const [retryingIds, setRetryingIds] = useState<readonly string[]>([]);
  const removedRef = useRef<Set<string>>(new Set());

  const onDocument = useCallback((doc: LibraryDocument) => {
    if (!removedRef.current.has(doc.id)) setDocs((prev) => upsert(prev, doc));
  }, []);
  const queue = useUploadQueue(onDocument);

  const refresh = useCallback(async () => {
    const res = await apiRequest<{ documents: LibraryDocument[] }>("/api/account/documents");
    if (res.ok && res.data) {
      const next = res.data.documents.filter((d) => !removedRef.current.has(d.id));
      setDocs(next);
      setLoadError(null);
    } else if (!res.ok) {
      setLoadError((prev) => prev ?? res.message ?? "We could not load your documents. Refresh to try again.");
    }
    setLoaded(true);
    return res.ok;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const anyPending = docs.some(isPending);
  useEffect(() => {
    if (!anyPending) return;
    const timer = window.setTimeout(() => void refresh(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [anyPending, docs, refresh]);

  async function retry(doc: LibraryDocument) {
    setRetryingIds((prev) => [...prev, doc.id]);
    const res = await apiRequest<{ document: LibraryDocument }>(`/api/account/documents/${doc.id}/process`, { method: "POST" });
    setRetryingIds((prev) => prev.filter((id) => id !== doc.id));
    if (res.ok && res.data) onDocument(res.data.document);
    else toast.error(res.message ?? "We could not read that file. Try again in a moment.");
  }

  async function confirmDelete(doc: LibraryDocument) {
    const snapshot = docs;
    removedRef.current.add(doc.id);
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    const res = await apiRequest(`/api/account/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) {
      toast.success("Document deleted");
      return;
    }
    removedRef.current.delete(doc.id);
    setDocs(snapshot);
    toast.error(res.message ?? "We could not delete that document. It was put back.");
  }

  const uploadingIds = useMemo(() => new Set(queue.items.map((item) => item.docId).filter(Boolean)), [queue.items]);
  const visible = useMemo(
    () => filterDocuments(docs.filter((d) => !uploadingIds.has(d.id)), filters),
    [docs, filters, uploadingIds],
  );
  const total = docs.length - docs.filter((d) => uploadingIds.has(d.id)).length;

  return (
    <div className="grid gap-12">
      <UploadPanel queue={queue} />

      <section aria-labelledby="library-heading" className="grid gap-5">
        <h2 id="library-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">Your library</h2>
        {loadError ? <Callout tone="danger" role="alert">{loadError}</Callout> : null}

        {!loaded ? (
          <LoadingState label="Loading your documents">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </LoadingState>
        ) : total === 0 && queue.items.length === 0 ? (
          <EmptyState icon={<FolderOpen />} title="No documents yet" description={PRIVACY} />
        ) : total > 0 ? (
          <>
            <LibraryToolbar filters={filters} onFilters={setFilters} shown={visible.length} total={total} />
            {visible.length === 0 ? (
              <EmptyState
                icon={<SearchX />}
                title="Nothing matches"
                description={hasActiveFilters(filters) ? "Try a different word or widen the dates." : PRIVACY}
              />
            ) : (
              <List label="Your documents">
                {visible.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    retrying={retryingIds.includes(doc.id)}
                    onRetry={(d) => void retry(d)}
                    onEdit={setEditing}
                    onDelete={setDeleting}
                  />
                ))}
              </List>
            )}
            <p className="m-0 text-small text-ink-2 text-pretty">{PRIVACY}</p>
          </>
        ) : null}
      </section>

      <EditDocumentDialog doc={editing} onClose={() => setEditing(null)} onSaved={onDocument} />
      <DeleteDocumentDialog doc={deleting} onClose={() => setDeleting(null)} onConfirm={(d) => void confirmDelete(d)} />
    </div>
  );
}

export function DocumentLibrary() {
  return <AccountGate path="/account/documents">{() => <LibraryBody />}</AccountGate>;
}
