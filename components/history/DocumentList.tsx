"use client";

import { useState } from "react";
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, List, ListRow,
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
      <h2 id="docs-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        Records you added ({documents.length})
      </h2>
      <List>
        {documents.map((doc) => (
          <ListRow
            key={doc.id}
            title={doc.title}
            meta={doc.docType.replaceAll("_", " ")}
            trailing={
              <Button
                variant="link"
                className="min-h-11 text-small"
                aria-label={`Delete ${doc.title}`}
                onClick={() => {
                  setError(null);
                  setPending(doc);
                }}
              >
                Delete
              </Button>
            }
          />
        ))}
      </List>
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
