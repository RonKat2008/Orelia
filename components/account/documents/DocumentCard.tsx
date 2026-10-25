"use client";

import { RotateCcw } from "lucide-react";
import { LIBRARY_DOC_TYPE_LABELS, type LibraryDocument } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/choice";
import { ListRow } from "@/components/ui/list-row";
import { cn } from "@/lib/ui/cn";
import { formatBytes } from "../helpers/files";
import { DocStatusChip } from "./StatusChip";

const ACTION = "min-h-11 text-small";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface DocumentCardProps {
  doc: LibraryDocument;
  retrying: boolean;
  onRetry: (doc: LibraryDocument) => void;
  onEdit: (doc: LibraryDocument) => void;
  onDelete: (doc: LibraryDocument) => void;
  /** "?case=ID" / "?draft=1" / "" so file links use the right space. */
  fileQuery?: string;
  onShareChange: (doc: LibraryDocument, shareWithResources: boolean) => void;
}

/** One document as a list row: title, a line of facts, its state in words, and quiet text actions. */
export function DocumentCard({ doc, fileQuery = "", retrying, onRetry, onEdit, onDelete, onShareChange }: DocumentCardProps) {
  const meta = [LIBRARY_DOC_TYPE_LABELS[doc.docType], formatDate(doc.dateOfService), doc.provider, formatBytes(doc.sizeBytes)].filter(Boolean);
  const hasFile = doc.status !== "pending_upload";
  const fileHref = `/api/account/documents/${doc.id}/file${fileQuery}`;
  const shareId = `share-${doc.id}`;
  return (
    <ListRow
      title={<span className="break-words">{doc.title}</span>}
      titleAs="h3"
      meta={meta.join(" · ")}
    >
      <div className="grid gap-2">
        <span aria-live="polite" className="w-fit">
          <DocStatusChip status={doc.status} />
        </span>
        {doc.tags.length > 0 ? <p className="m-0 text-small text-ink-2">Tags: {doc.tags.join(", ")}</p> : null}
        {doc.statusDetail ? (
          <p className={cn("m-0 text-small text-pretty", doc.status === "failed" ? "font-semibold text-danger" : "text-ink-2")} role={doc.status === "failed" ? "alert" : undefined}>
            {doc.statusDetail}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Switch
            id={shareId}
            checked={doc.shareWithResources}
            onCheckedChange={(checked) => onShareChange(doc, checked)}
            aria-describedby={`${shareId}-hint`}
          />
          <div className="grid">
            <label htmlFor={shareId} className="cursor-pointer text-small font-semibold text-ink">
              Share with resources<span className="sr-only">: {doc.title}</span>
            </label>
            <span id={`${shareId}-hint`} className="text-small text-ink-2">
              Lets resource-facing agents see this document. Off by default.
            </span>
          </div>
        </div>
        <div className="-ml-0 flex flex-wrap items-center gap-x-5 gap-y-0">
          {hasFile ? (
            <>
              <Button asChild variant="link" className={ACTION}>
                <a href={fileHref} target="_blank" rel="noopener noreferrer">
                  Open<span className="sr-only"> {doc.title} in a new tab</span>
                </a>
              </Button>
              <Button asChild variant="link" className={ACTION}>
                <a href={`${fileHref}${fileQuery ? "&" : "?"}download=1`}>
                  Download<span className="sr-only"> {doc.title}</span>
                </a>
              </Button>
            </>
          ) : null}
          {doc.status === "failed" ? (
            <Button variant="link" className={ACTION} loading={retrying} loadingText="Retrying" onClick={() => onRetry(doc)}>
              <RotateCcw aria-hidden />Try again<span className="sr-only"> {doc.title}</span>
            </Button>
          ) : null}
          <Button variant="link" className={ACTION} onClick={() => onEdit(doc)}>
            Edit<span className="sr-only"> details of {doc.title}</span>
          </Button>
          <Button variant="link" className={ACTION} onClick={() => onDelete(doc)}>
            Delete<span className="sr-only"> {doc.title}</span>
          </Button>
        </div>
      </div>
    </ListRow>
  );
}
