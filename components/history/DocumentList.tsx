"use client";

import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui";
import type { HistoryTimeline } from "@/lib/history/contract";

type Doc = HistoryTimeline["documents"][number];

/** The records behind the timeline, each removable after a confirmation. */
export function DocumentList({
  documents, onDelete,
}: {
  documents: readonly Doc[];
  /** Resolves to an error message, or null on success. */
  onDelete: (docId: string) => Promise<string | null>;
}) {
  const [pending, setPending] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const message = await onDelete(pending.id);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setPending(null);
  }

  return (
    <section aria-labelledby="docs-heading" className="grid gap-3">
      <h3 id="docs-heading" className="m-0 font-display text-h4 font-normal text-ink">
        Records you added ({documents.length})
      </h3>
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-2 p-0">
        {documents.map((doc) => (
          <li key={doc.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line bg-card p-3">
            <span className="flex min-w-0 items-center gap-2">
              <FileText aria-hidden className="size-4 shrink-0 text-teal" />
              <span className="truncate text-body text-ink">{doc.title}</span>
              <Badge tone="outline">{doc.docType.replaceAll("_", " ")}</Badge>
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Delete ${doc.title}`}
              onClick={() => {
                setError(null);
                setPending(doc);
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this record?</DialogTitle>
            <DialogDescription>
              &ldquo;{pending?.title}&rdquo; and the timeline events taken from it will be removed.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="m-0 text-small font-semibold text-danger">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>Keep it</Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={busy} aria-busy={busy}>
              {busy ? "Deleting..." : "Delete record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
