"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  FileText,
  Globe,
  KeyRound,
  Lock,
  NotebookPen,
  Plus,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Field,
  Input,
  Skeleton,
  Textarea,
  toast,
} from "@/components/ui";
import {
  addPatientNote,
  groupDocuments,
  humanizeTitle,
  kindLabel,
  loadDocuments,
  sharingKind,
  sharingLine,
  type CaseDocument,
  type SharingKind,
} from "./data";

const SHARING: Record<
  SharingKind,
  { tone: "danger" | "sage" | "teal"; Icon: typeof Lock }
> = {
  never: { tone: "danger", Icon: Lock },
  public: { tone: "sage", Icon: Globe },
  consented: { tone: "teal", Icon: KeyRound },
};

function SharingBadge({ document }: { document: CaseDocument }) {
  const { tone, Icon } = SHARING[sharingKind(document)];
  return (
    <Badge
      tone={tone}
      size="md"
      className="h-auto min-h-7 whitespace-normal py-1 text-left leading-snug"
    >
      <Icon aria-hidden />
      {sharingLine(document)}
    </Badge>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function AddNoteDialog({
  caseId,
  onAdded,
}: {
  caseId: string;
  onAdded: (document: CaseDocument, preview: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sharedField, setSharedField] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setError("Add a title and the note text before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await addPatientNote(caseId, {
      title: title.trim(),
      text: text.trim(),
      sharedField: sharedField.trim() || undefined,
    });
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onAdded(result.document, result.preview);
    toast.success(
      result.preview ? "Note saved on this page for now." : "Note saved.",
    );
    setTitle("");
    setText("");
    setSharedField("");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Add a note
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Add a note</DialogTitle>
            <DialogDescription>
              Outreach can use this note only for the field you name. Leave the
              field blank and it stays general public context, not part of the
              intake report.
            </DialogDescription>
          </DialogHeader>
          <Field label="Title" htmlFor="note-title">
            <Input
              id="note-title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label="Note" htmlFor="note-text">
            <Textarea
              id="note-text"
              name="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field
            label="Field you consent to share"
            htmlFor="note-field"
            hint="For example: condition name, home city."
            optional
          >
            <Input
              id="note-field"
              name="sharedField"
              placeholder="condition name"
              aria-describedby="note-field-hint"
              value={sharedField}
              onChange={(event) => setSharedField(event.target.value)}
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="m-0 text-small font-semibold text-danger"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" loading={saving} loadingText="Saving">
              Save note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsPanel({ caseId }: { caseId: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">(
    "loading",
  );
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadDocuments(caseId).then((result) => {
      if (!active) return;
      if (result.status === "error") {
        setStatus("error");
        setMessage(result.message);
        return;
      }
      setPreview(result.preview);
      if (result.status === "empty") {
        setStatus("empty");
        setDocuments([]);
        return;
      }
      setStatus("ready");
      setDocuments(result.documents);
    });
    return () => {
      active = false;
    };
  }, [caseId, attempt]);

  function onAdded(document: CaseDocument, isPreview: boolean) {
    setDocuments((current) => [...current, document]);
    setStatus("ready");
    setPreview(isPreview);
  }

  const groups = groupDocuments(documents);

  if (status === "loading") {
    return (
      <div role="status" aria-busy="true" className="grid gap-6">
        <span className="sr-only">Loading documents</span>
        {[0, 1].map((key) => (
          <div key={key} className="grid gap-3">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className="grid gap-3 rounded-lg border border-danger/30 bg-danger-soft p-6"
      >
        <h2 className="m-0 font-display text-h3 font-normal text-ink display-soft">
          Documents could not be loaded
        </h2>
        <p className="m-0 text-body text-ink-2">{message}</p>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setStatus("loading");
              setAttempt((current) => current + 1);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {preview ? (
          <p className="m-0 flex flex-wrap items-center gap-2 text-small text-ink-2">
            <Badge tone="gold">Sample</Badge>
            Preview of what outreach agents can draw on. The live list replaces
            it when that service answers.
          </p>
        ) : (
          <span />
        )}
        <AddNoteDialog caseId={caseId} onAdded={onAdded} />
      </div>

      {status === "empty" ? (
        <EmptyState
          icon={<NotebookPen />}
          title="No documents yet"
          description="A note you add here is available to outreach only for the field you name. Your intake report is never sent."
        />
      ) : null}

      {groups.map((group) => (
        <DocumentGroup key={group.kind} kind={group.kind} items={group.items} />
      ))}
    </div>
  );
}

const COLLAPSED_COUNT = 6;

function DocumentGroup({
  kind,
  items,
}: {
  kind: string;
  items: CaseDocument[];
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  return (
    <section
      aria-labelledby={`docs-${kind}`}
      className="grid grid-cols-[minmax(0,1fr)] gap-4"
    >
      <h2
        id={`docs-${kind}`}
        className="m-0 max-w-none border-b border-line pb-3 font-display text-h3 font-normal text-ink display-soft"
      >
        {kindLabel(kind)}
        <span className="ml-2 font-sans text-body font-normal text-ink-3">
          ({items.length})
        </span>
      </h2>
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
        {shown.map((document) => (
          <li
            key={document.id}
            className="grid min-w-0 content-start gap-3 rounded-lg border border-line bg-card p-5 shadow-xs"
          >
            <div className="flex items-start gap-3">
              <FileText
                aria-hidden
                className="mt-1 size-5 shrink-0 text-ink-3"
              />
              <div className="grid min-w-0 gap-0.5">
                <h3 className="m-0 break-words font-sans text-h4 font-bold text-ink">
                  {humanizeTitle(document.title)}
                </h3>
                <p className="m-0 text-small text-ink-3">
                  {formatWhen(document.createdAt)}
                </p>
              </div>
            </div>
            <SharingBadge document={document} />
          </li>
        ))}
      </ul>
      {items.length > COLLAPSED_COUNT ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
