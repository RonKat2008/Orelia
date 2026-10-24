"use client";

import { useRef, useState, type DragEvent } from "react";
import { FileUp, RotateCcw } from "lucide-react";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from "@/lib/accounts/contract";
import { Button } from "@/components/ui/button";
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
      className="h-1.5 overflow-hidden rounded-pill bg-line"
    >
      <div
        className="h-full w-full origin-left rounded-pill bg-teal transition-transform duration-300 ease-out-expo motion-reduce:transition-none"
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
      />
    </div>
  );
}

function StagedRow({ item, queue, primary }: { item: UploadItem; queue: Queue; primary: boolean }) {
  const editable = item.phase === "staged";
  const inFlight = isActivePhase(item.phase) || item.phase === "queued";
  return (
    <li className="grid gap-4 border-b border-line py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-body font-semibold text-ink" title={item.file.name}>{item.file.name}</p>
          <p className="m-0 text-small text-ink-2">{formatBytes(item.file.size)}</p>
        </div>
        <span aria-live="polite" aria-atomic="true">
          <UploadPhaseChip phase={item.phase} progress={item.progress} />
        </span>
        {editable ? (
          <Button variant="link" className="min-h-11 text-small" onClick={() => queue.remove(item.key)} aria-label={`Remove ${item.file.name}`}>
            Remove
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
          <Button size={primary ? "lg" : "md"} variant={primary ? "primary" : "link"} className={primary ? undefined : "min-h-11"} onClick={() => queue.start([item.key])}>
            Upload this file
          </Button>
        </div>
      ) : null}
      {item.phase === "failed" ? (
        <div>
          <Button variant="link" className="min-h-11" onClick={() => queue.start([item.key])}>
            <RotateCcw aria-hidden />Try again
          </Button>
        </div>
      ) : null}
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

  const staged = queue.stagedKeys.length;
  // One primary on the page: "Choose files" until something is staged, then the upload button.
  const choosePrimary = queue.items.length === 0;

  return (
    <section aria-labelledby="upload-heading" className="grid gap-5">
      <h2 id="upload-heading" className="sr-only">Add documents</h2>
      <div
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={onDrop}
        className={cn(
          "grid justify-items-start gap-3 rounded-lg border border-dashed px-5 py-7",
          "transition-[background-color,border-color] duration-300 ease-out-expo motion-reduce:transition-none",
          dragging ? "border-teal bg-teal-soft" : "border-line-strong bg-paper-2/60",
        )}
      >
        <p className="m-0 text-body font-semibold text-ink">Drop files here, or choose them</p>
        <p className="m-0 text-small text-ink-2">PDF, PNG, JPG, HEIC, TXT or DOCX, up to {formatBytes(MAX_FILE_BYTES)} each.</p>
        <Button
          variant={choosePrimary ? "primary" : "secondary"}
          size={choosePrimary ? "lg" : "md"}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden />Choose files
        </Button>
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
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 font-display text-h3 font-normal text-ink display-soft">
              {queue.items.length === 1 ? "1 file" : `${queue.items.length} files`}
            </h3>
            {staged > 1 ? (
              <Button size="lg" onClick={() => queue.start(queue.stagedKeys)}>Upload all ({staged})</Button>
            ) : null}
          </div>
          <ul className="m-0 grid list-none border-t border-line p-0">
            {queue.items.map((item) => <StagedRow key={item.key} item={item} queue={queue} primary={staged === 1} />)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
