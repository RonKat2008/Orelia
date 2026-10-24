"use client";

import { useId, useRef, useState, type DragEvent, type FormEvent } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Button, Field, Input, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, controlClasses } from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { DOC_TYPES, MAX_RECORD_CHARS, MAX_TITLE_CHARS, type AddRecordBody, type DocType } from "@/lib/history/contract";
import { checkRecordFile, checkRecordText, MAX_PDF_MB, PDF_FILE_PATTERN, PDF_TOO_LARGE_MESSAGE } from "./model";

const DOC_TYPE_LABELS: Record<DocType, string> = {
  visit_note: "Visit note",
  genetic_report: "Genetic report",
  imaging_report: "Imaging report",
  lab_report: "Lab report",
  letter: "Letter",
  discharge_summary: "Discharge summary",
  other: "Other",
};

type FileStatus = { name: string; state: "reading" | "uploading" | "done" | "error"; message?: string };

/** Adds records: drop or choose text files, or paste text. Each file reports its own progress. */
export function RecordDropzone({
  onSubmit,
  onUploadPdf,
  primary = true,
}: {
  /** The page's one primary action when there are no records yet; a secondary once the header owns it. */
  primary?: boolean;
  /** Uploads a PDF for server-side text extraction. Resolves to an error message, or null on success. */
  onUploadPdf: (file: File) => Promise<string | null>;
  /** Resolves to an error message, or null on success. */
  onSubmit: (body: AddRecordBody) => Promise<string | null>;
}) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [docType, setDocType] = useState<DocType | "">("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setStatus = (name: string, patch: Partial<FileStatus>) =>
    setFiles((list) => list.map((f) => (f.name === name ? { ...f, ...patch } : f)));

  async function handleFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setFiles(picked.map((file) => ({ name: file.name, state: "reading" })));
    for (const file of picked) {
      const check = checkRecordFile(file.name);
      if (!check.ok) {
        setStatus(file.name, { state: "error", message: check.message });
        continue;
      }
      if (PDF_FILE_PATTERN.test(file.name)) {
        if (file.size > MAX_PDF_MB * 1024 * 1024) {
          setStatus(file.name, { state: "error", message: PDF_TOO_LARGE_MESSAGE });
          continue;
        }
        setStatus(file.name, { state: "uploading" });
        const pdfError = await onUploadPdf(file);
        setStatus(file.name, pdfError ? { state: "error", message: pdfError } : { state: "done" });
        continue;
      }
      let content = "";
      try {
        content = await file.text();
      } catch {
        setStatus(file.name, { state: "error", message: `${file.name} could not be read.` });
        continue;
      }
      const textCheck = checkRecordText(file.name, content);
      if (!textCheck.ok) {
        setStatus(file.name, { state: "error", message: textCheck.message });
        continue;
      }
      setStatus(file.name, { state: "uploading" });
      const error = await onSubmit({ title: check.title.slice(0, MAX_TITLE_CHARS), text: content });
      setStatus(file.name, error ? { state: "error", message: error } : { state: "done" });
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  }

  async function onPaste(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setPasteError("Add a title and paste the record text");
      return;
    }
    if (text.length > MAX_RECORD_CHARS) {
      setPasteError(`That is longer than ${MAX_RECORD_CHARS.toLocaleString("en-US")} characters. Split it into parts.`);
      return;
    }
    setSaving(true);
    setPasteError(null);
    const error = await onSubmit({ title: title.trim(), text: text.trim(), ...(docType ? { docType } : {}) });
    setSaving(false);
    if (error) {
      setPasteError(error);
      return;
    }
    setTitle("");
    setText("");
    setDocType("");
  }

  const variant = primary ? "primary" : "secondary";
  return (
    <section id="add-records" aria-label="Add your records" className="grid scroll-mt-24 gap-4">
      <Tabs defaultValue="upload" className="gap-5">
        <TabsList aria-label="How to add a record">
          <TabsTrigger value="upload">Upload files</TabsTrigger>
          <TabsTrigger value="paste">Paste text</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="grid gap-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "grid justify-items-start gap-4 rounded-lg border border-dashed px-5 py-6 transition-colors motion-reduce:transition-none",
              dragging ? "border-teal bg-teal-soft" : "border-line-strong bg-paper-2/60",
            )}
          >
            <p className="m-0 max-w-[46ch] text-body text-ink-2">
              Drop .txt, .md or .pdf files here. For a scanned PDF, copy its text and use Paste text.
            </p>
            <input
              ref={fileInput}
              id={inputId}
              type="file"
              multiple
              aria-label="Choose record files"
              accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => event.target.files && void handleFiles(event.target.files)}
            />
            <Button type="button" variant={variant} size={primary ? "lg" : "md"} onClick={() => fileInput.current?.click()}>
              <FileUp aria-hidden /> Choose files
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="paste">
          <form onSubmit={onPaste} className="grid gap-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <Field label="Title" htmlFor="paste-title">
                <Input id="paste-title" value={title} maxLength={MAX_TITLE_CHARS} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Type" htmlFor="paste-type" optional>
                <select
                  id="paste-type"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocType | "")}
                  className={cn(controlClasses, "h-11")}
                >
                  <option value="">We will work it out</option>
                  {DOC_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DOC_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Record text"
              htmlFor="paste-text"
              hint={`${text.length.toLocaleString("en-US")} / ${MAX_RECORD_CHARS.toLocaleString("en-US")} characters`}
              error={pasteError ?? undefined}
            >
              <Textarea
                id="paste-text"
                rows={6}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={pasteError ? true : undefined}
                aria-describedby={pasteError ? "paste-text-hint paste-text-error" : "paste-text-hint"}
              />
            </Field>
            <div>
              <Button type="submit" variant={variant} size={primary ? "lg" : "md"} loading={saving} loadingText="Adding">
                Add this record
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {files.length > 0 ? (
        <ul aria-live="polite" aria-label="Files being added" className="m-0 grid list-none gap-2 p-0 text-small">
          {files.map((file) => (
            <li key={file.name} className="flex items-start gap-2 text-ink-2">
              {file.state === "reading" || file.state === "uploading" ? (
                <Loader2 aria-hidden className="mt-0.5 size-4 animate-spin motion-reduce:animate-none" />
              ) : null}
              <span className={file.state === "error" ? "text-danger" : undefined}>
                <strong className="font-semibold text-ink">{file.name}</strong>{" "}
                {file.state === "reading" && "Reading..."}
                {file.state === "uploading" && "Adding to your timeline..."}
                {file.state === "done" && "Added."}
                {file.state === "error" && file.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
