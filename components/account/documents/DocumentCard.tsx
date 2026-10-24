"use client";

import { Download, ExternalLink, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { LIBRARY_DOC_TYPE_LABELS, type LibraryDocument } from "@/lib/accounts/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";
import { formatBytes } from "../helpers/files";
import { DocStatusChip } from "./StatusChip";

export type LibraryView = "grid" | "list";

const ACTION =
  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-small font-semibold text-ink no-underline " +
  "transition-colors duration-150 hover:bg-paper-2 active:bg-line/60 focus-ring [&_svg]:size-4 [&_svg]:text-ink-2";

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface DocumentCardProps {
  doc: LibraryDocument;
  view: LibraryView;
  retrying: boolean;
  onRetry: (doc: LibraryDocument) => void;
  onEdit: (doc: LibraryDocument) => void;
  onDelete: (doc: LibraryDocument) => void;
}

export function DocumentCard({ doc, view, retrying, onRetry, onEdit, onDelete }: DocumentCardProps) {
  const date = formatDate(doc.dateOfService);
  const meta = [date, doc.provider, formatBytes(doc.sizeBytes)].filter(Boolean);
  const hasFile = doc.status !== "pending_upload";
  const fileHref = `/api/account/documents/${doc.id}/file`;
  return (
    <article
      aria-label={doc.title}
      className={cn(
        "group grid min-w-0 gap-3 rounded-lg border border-line bg-card p-5 shadow-xs",
        "transition-[border-color,box-shadow] duration-300 ease-out-expo hover:border-line-strong hover:shadow-md motion-reduce:transition-none",
        view === "list" && "sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-x-6",
      )}
    >
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{LIBRARY_DOC_TYPE_LABELS[doc.docType]}</Badge>
          <span aria-live="polite"><DocStatusChip status={doc.status} /></span>
        </div>
        <h3 className="m-0 break-words font-display text-h4 font-normal leading-snug text-ink">{doc.title}</h3>
        <p className="m-0 break-words text-small text-ink-2">{meta.join(" · ")}</p>
        {doc.tags.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Tags">
            {doc.tags.map((tag) => <li key={tag}><Badge tone="outline">{tag}</Badge></li>)}
          </ul>
        ) : null}
        {doc.statusDetail ? (
          <p className={cn("m-0 text-small text-pretty", doc.status === "failed" ? "font-semibold text-danger" : "text-ink-2")} role={doc.status === "failed" ? "alert" : undefined}>
            {doc.statusDetail}
          </p>
        ) : null}
      </div>

      <div className={cn("-ml-3 flex flex-wrap items-center gap-1", view === "list" && "sm:ml-0 sm:justify-end")}>
        {hasFile ? (
          <>
            <a href={fileHref} target="_blank" rel="noopener noreferrer" className={ACTION}>
              <ExternalLink aria-hidden />Open<span className="sr-only"> {doc.title} in a new tab</span>
            </a>
            <a href={`${fileHref}?download=1`} className={ACTION}>
              <Download aria-hidden />Download<span className="sr-only"> {doc.title}</span>
            </a>
          </>
        ) : null}
        {doc.status === "failed" ? (
          <Button variant="ghost" size="sm" loading={retrying} loadingText="Retrying" onClick={() => onRetry(doc)}>
            <RotateCcw aria-hidden />Retry<span className="sr-only"> {doc.title}</span>
          </Button>
        ) : null}
        <button type="button" className={ACTION} onClick={() => onEdit(doc)}>
          <Pencil aria-hidden />Edit<span className="sr-only"> details of {doc.title}</span>
        </button>
        <button type="button" className={cn(ACTION, "hover:text-danger [&_svg]:hover:text-danger")} onClick={() => onDelete(doc)}>
          <Trash2 aria-hidden />Delete<span className="sr-only"> {doc.title}</span>
        </button>
      </div>
    </article>
  );
}
