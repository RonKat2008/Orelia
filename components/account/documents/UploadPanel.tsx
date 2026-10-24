"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileUp, RotateCcw, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/ui/cn";
import { Callout } from "../FormBits";
import { formatBytes, validateFile } from "../helpers/files";
import { MetadataFields } from "./MetadataFields";
import { UploadPhaseChip } from "./StatusChip";
import { isActivePhase, type UploadItem, type useUploadQueue } from "./useUploadQueue";

type Queue = ReturnType<typeof useUploadQueue>;

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className="h-1.5 overflow-hidden rounded-pill bg-paper-2 shadow-inset"
    >
      <div
        className="h-full w-full origin-left rounded-pill bg-teal transition-transform duration-300 ease-out-expo motion-reduce:transition-none"
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
      />
    </div>
  );
}

function StagedRow({ item, queue }: { item: UploadItem; queue: Queue }) {
  const editable = item.phase === "staged";
  const inFlight = isActivePhase(item.phase) || item.phase === "queued";
  return (
    <li>
      <Card padding="sm" className="grid gap-4 animate-rise motion-reduce:animate-none sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-small font-semibold text-ink" title={item.file.name}>{item.file.name}</p>
            <p className="m-0 text-micro text-ink-3">{formatBytes(item.file.size)}</p>
          </div>
          <span aria-live="polite" aria-atomic="true">
            <UploadPhaseChip phase={item.phase} progress={item.progress} />
          </span>
          {editable ? (
            <Button variant="ghost" size="sm" onClick={() => queue.remove(item.key)} aria-label={`Remove ${item.file.name}`}>
              <X aria-hidden />Remove
            </Button>
          ) : null}
        </div>

        {editable ? (
          <MetadataFields
            idPrefix={`up-${item.key}`}
            draft={item.draft}
            errors={item.fieldErrors}
            onChange={(change) => queue.updateDraft(item.key, change)}
          />
        ) : null}

        {inFlight || item.phase === "failed" ? (
          <ProgressBar
            value={item.phase === "uploading" ? item.progress : item.blobDone || item.phase === "processing" ? 100 : 0}
            label={`Upload progress for ${item.file.name}`}
          />
        ) : null}

        {item.error ? <Callout tone="danger" role="alert">{item.error}</Callout> : null}

        {editable ? (
          <div>
            <Button size="sm" onClick={() => queue.start([item.key])}>Upload this file</Button>
          </div>
        ) : null}
        {item.phase === "failed" ? (
          <div>
            <Button size="sm" variant="secondary" onClick={() => queue.start([item.key])}>
              <RotateCcw aria-hidden />Retry
            </Button>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** Dropzone + file picker + the staged rows for files that are waiting for details or on their way up. */
export function UploadPanel({ queue }: { queue: Queue }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  function take(list: FileList | File[]) {
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of Array.from(list)) {
      const problem = validateFile(file);
      if (problem) rejected.push(problem);
      else accepted.push(file);
    }
    setRejections(rejected);
    if (accepted.length > 0) queue.addFiles(accepted);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  }

  return (
    <section aria-labelledby="upload-heading" className="grid gap-5">
      <h2 id="upload-heading" className="sr-only">Add documents</h2>
      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={onDrop}
        className={cn(
          "grain grid justify-items-center gap-3 rounded-lg border-[1.5px] border-dashed px-5 py-9 text-center",
          "transition-[background-color,border-color,transform] duration-300 ease-out-expo motion-reduce:transition-none",
          dragging ? "scale-[1.005] border-teal bg-teal-soft" : "border-line-strong bg-paper-2/60",
        )}
      >
        <span aria-hidden className="grid size-12 place-items-center rounded-pill bg-card text-teal shadow-sm ring-1 ring-line">
          <FileUp className="size-6" />
        </span>
        <p className="m-0 font-display text-h4 text-ink">Drop files here, or choose them</p>
        <p className="m-0 text-small text-ink-2">PDF, PNG, JPG, HEIC, TXT or DOCX, up to {formatBytes(MAX_FILE_BYTES)} each.</p>
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose files</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          aria-label="Choose documents to upload"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            take(event.target.files ?? []);
            event.target.value = "";
          }}
        />
      </div>

      {rejections.length > 0 ? (
        <div role="alert" className="grid gap-2">
          {rejections.map((message) => <Callout key={message} tone="warn">{message}</Callout>)}
        </div>
      ) : null}

      {queue.items.length > 0 ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 font-display text-h4 text-ink">
              {queue.items.length === 1 ? "1 file" : `${queue.items.length} files`}
            </h3>
            {queue.stagedKeys.length > 1 ? (
              <Button onClick={() => queue.start(queue.stagedKeys)}>Upload all ({queue.stagedKeys.length})</Button>
            ) : null}
          </div>
          <ul className="m-0 grid list-none gap-4 p-0">
            {queue.items.map((item) => <StagedRow key={item.key} item={item} queue={queue} />)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
