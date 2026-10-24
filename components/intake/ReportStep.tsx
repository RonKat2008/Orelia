"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import {
  Button,
  Field,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import type { DemoReport } from "./demos";
import { INTAKE_COPY } from "./patient/copy";

type Props = {
  demos: DemoReport[];
  reportText: string;
  busy: boolean;
  error: string | null;
  onTextChange: (text: string) => void;
  onSample: (demo: DemoReport) => void;
  onFile: (file: File) => void;
  onExtract: () => void;
  /** "patient" uses the plain intake copy; "judge" (default) the working copy. */
  audience?: "patient" | "judge";
  /** Rendered under the heading, before the form (the "start from my profile" card). */
  prefill?: ReactNode;
};

type UploadCopy = {
  [K in Exclude<keyof typeof INTAKE_COPY.upload, "readingNote" | "empty" | "unreadable" | "readFailed" | "words">]: string;
} & { words: (count: number) => string };

const TEXTAREA_ID = "report-text";
const SAMPLE_ID = "report-sample";
const ERROR_ID = "report-error";

const JUDGE_COPY: UploadCopy = {
  title: "Paste a report or clinic letter",
  lede: "We copy out only the details needed to search. You check them next.",
  textLabel: "Report text",
  textHint:
    "Synthetic or de-identified text only. Remove names and record numbers before pasting.",
  placeholder:
    "Paste the report here, or drag a .txt or .md file onto this box.",
  upload: "Upload a .txt or .md file",
  nothing: "Nothing added yet",
  words: (count) => `${count} words ready`,
  sampleLabel: "Try a sample report",
  samplePlaceholder: "Choose a sample",
  sampleNote: "Samples are synthetic. No real patient is described.",
  noSamples: "No sample reports found.",
  read: "Read the report",
  reading: "Reading the report",
};

function SamplePicker({
  demos,
  reportText,
  onSample,
  copy,
}: Pick<Props, "demos" | "reportText" | "onSample"> & { copy: UploadCopy }) {
  if (demos.length === 0)
    return <p className="m-0 text-small text-ink-2">{copy.noSamples}</p>;
  const active = demos.find((demo) => demo.reportText === reportText);
  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor={SAMPLE_ID}>{copy.sampleLabel}</Label>
      <Select
        value={active?.id ?? ""}
        onValueChange={(id) => {
          const demo = demos.find((item) => item.id === id);
          if (demo) onSample(demo);
        }}
      >
        <SelectTrigger id={SAMPLE_ID}>
          <SelectValue placeholder={copy.samplePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {demos.map((demo) => (
            <SelectItem key={demo.id} value={demo.id}>
              {demo.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="m-0 text-small text-ink-2">{copy.sampleNote}</p>
    </div>
  );
}

export function ReportStep({
  demos,
  reportText,
  busy,
  error,
  onTextChange,
  onSample,
  onFile,
  onExtract,
  audience = "judge",
  prefill,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const copy: UploadCopy =
    audience === "patient" ? INTAKE_COPY.upload : JUDGE_COPY;

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <section aria-labelledby="report-heading" className="grid max-w-3xl gap-8">
      <div className="grid gap-2">
        <h1
          id="report-heading"
          tabIndex={-1}
          className="m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance outline-none"
        >
          {copy.title}
        </h1>
        <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
          {copy.lede}
        </p>
      </div>

      {prefill}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "grid gap-4 rounded-lg border border-dashed bg-card p-4 sm:p-6",
          "transition-[border-color,background-color] duration-150 motion-reduce:transition-none",
          dragging ? "border-teal bg-teal-soft/50" : "border-line-strong",
        )}
      >
        <Field
          label={copy.textLabel}
          htmlFor={TEXTAREA_ID}
          hint={copy.textHint}
        >
          <Textarea
            id={TEXTAREA_ID}
            rows={12}
            value={reportText}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={copy.placeholder}
            aria-describedby={`${TEXTAREA_ID}-hint${error ? ` ${ERROR_ID}` : ""}`}
            aria-invalid={error ? true : undefined}
            className="min-h-64 font-sans text-body leading-relaxed"
            disabled={busy}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            id="report-file"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload aria-hidden />
            {copy.upload}
          </Button>
          <span className="text-small text-ink-2">
            {reportText.trim()
              ? copy.words(reportText.trim().split(/\s+/).length)
              : copy.nothing}
          </span>
        </div>
      </div>

      <SamplePicker
        demos={demos}
        reportText={reportText}
        onSample={onSample}
        copy={copy}
      />

      {error ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-body text-ink"
        >
          {error}
        </p>
      ) : null}

      <div>
        <Button
          type="button"
          size="lg"
          onClick={onExtract}
          loading={busy}
          loadingText={copy.reading}
        >
          {copy.read}
        </Button>
      </div>
    </section>
  );
}
