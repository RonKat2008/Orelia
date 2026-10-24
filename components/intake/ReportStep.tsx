"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowRight, FileText, Upload } from "lucide-react";
import { Button, EmptyState, Field, Textarea } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import type { DemoReport } from "./demos";

type Props = {
  demos: DemoReport[];
  reportText: string;
  busy: boolean;
  error: string | null;
  onTextChange: (text: string) => void;
  onSample: (demo: DemoReport) => void;
  onFile: (file: File) => void;
  onExtract: () => void;
};

const TEXTAREA_ID = "report-text";

function SampleButtons({ demos, reportText, onSample }: Pick<Props, "demos" | "reportText" | "onSample">) {
  if (demos.length === 0) {
    return (
      <EmptyState
        title="No sample cases found"
        description="Paste a synthetic report below, or upload a text file. Nothing is interpreted."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <p id="sample-label" className="m-0 text-micro font-semibold uppercase text-ink-3">
        No report handy? Try a sample case
      </p>
      <ul aria-labelledby="sample-label" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {demos.map((demo) => {
          const active = demo.reportText === reportText;
          return (
            <li key={demo.id}>
              <Button
                type="button"
                variant={active ? "primary" : "secondary"}
                size="sm"
                aria-pressed={active}
                onClick={() => onSample(demo)}
              >
                <FileText aria-hidden />
                {demo.title}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-small text-ink-2">Samples are synthetic. No real patient is described.</p>
    </div>
  );
}

export function ReportStep({ demos, reportText, busy, error, onTextChange, onSample, onFile, onExtract }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <section aria-labelledby="report-heading" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="grid gap-8">
        <div className="grid gap-2">
          <h2 id="report-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
            Share a <em className="emph">report</em>
          </h2>
          <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
            Paste a pathology or clinic summary, or drop in a text file. We only copy out the details needed to search.
          </p>
        </div>

        <SampleButtons demos={demos} reportText={reportText} onSample={onSample} />

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "grid gap-4 rounded-lg border border-dashed bg-card p-4 shadow-xs transition-[border-color,background-color] duration-300 sm:p-6",
            "motion-reduce:transition-none",
            dragging ? "border-teal bg-teal-soft/50" : "border-line-strong",
          )}
        >
          <Field
            label="Report text"
            htmlFor={TEXTAREA_ID}
            hint="Synthetic or de-identified text only. Remove names and record numbers before pasting."
          >
            <Textarea
              id={TEXTAREA_ID}
              rows={12}
              value={reportText}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder="Paste the report here, or drag a .txt or .md file onto this box."
              aria-describedby={`${TEXTAREA_ID}-hint`}
              className="min-h-64 font-mono text-mono leading-relaxed"
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
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload aria-hidden />
              Upload a .txt or .md file
            </Button>
            <span className="text-small text-ink-2">
              {reportText.trim() ? `${reportText.trim().split(/\s+/).length} words ready` : "Nothing added yet"}
            </span>
          </div>
        </div>

        {error ? (
          <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-body text-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button
            type="button"
            size="lg"
            onClick={onExtract}
            disabled={!reportText.trim()}
            loading={busy}
            loadingText="Reading the report"
          >
            Read the report
            {busy ? null : <ArrowRight aria-hidden />}
          </Button>
          <p className="m-0 text-small text-ink-2">You will review everything before any search starts.</p>
        </div>
      </div>

      <aside aria-label="What happens next" className="grid content-start gap-4">
        <ol className="m-0 grid list-none gap-5 p-0">
          {[
            ["We read it", "The details we need are pulled out, not interpreted."],
            ["You check it", "Every field is editable. Nothing is assumed."],
            ["Nine searches run", "Papers, trials, specialists, centers, advocacy and aid, at once."],
          ].map(([title, body], index) => (
            <li key={title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-pill border border-line-strong bg-card font-display text-h4 text-teal shadow-xs"
              >
                {index + 1}
              </span>
              <span className="grid gap-0.5">
                <span className="font-semibold text-ink">{title}</span>
                <span className="text-small text-ink-2">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
