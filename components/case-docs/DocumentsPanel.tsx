"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { NotebookPen, Plus } from "lucide-react";
import {
  Button,
  Details,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorSummary,
  Field,
  Input,
  List,
  ListRow,
  LoadingState,
  PageHeader,
  Skeleton,
  Textarea,
  toast,
} from "@/components/ui";
import {
  addPatientNote,
  dedupeDocuments,
  documentLabel,
  groupDocuments,
  kindLabel,
  loadDocuments,
  plainSharingLine,
  sharedContactCount,
  type CaseDocument,
} from "./data";

/** Reading order on this page; the long list of research sources goes last, inside a disclosure. */
/** Heading level for the page title. h2 while the case shell still prints the h1 (lane A part 2 flips this). */
const CASE_PAGE_HEADING = "h2" as const;

const GROUP_ORDER = ["case_summary", "patient_note", "public_resource", "intake_report", "evidence"];
const DISCLOSED_KINDS = new Set(["evidence"]);

function sharedWith(count: number): string | null {
  return count > 0 ? `Shared with: ${count} ${count === 1 ? "contact" : "contacts"}` : null;
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
  const [invalid, setInvalid] = useState<{ fieldId: string; message: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setInvalid(
        !title.trim()
          ? { fieldId: "note-title", message: "Add a title for your note" }
          : { fieldId: "note-text", message: "Write your note" },
      );
      return;
    }
    setSaving(true);
    setError(null);
    setInvalid(null);
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
              We only use a note for the detail you name. If you name none, it
              stays general background and is not part of your intake report.
            </DialogDescription>
          </DialogHeader>
          {invalid ? <ErrorSummary errors={[invalid]} /> : null}
          {error ? (
            <p role="alert" className="m-0 text-small font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <Field
            label="Title"
            htmlFor="note-title"
            error={invalid?.fieldId === "note-title" ? invalid.message : undefined}
          >
            <Input
              id="note-title"
              name="title"
              autoComplete="off"
              aria-invalid={invalid?.fieldId === "note-title" || undefined}
              aria-describedby={invalid?.fieldId === "note-title" ? "note-title-error" : undefined}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field
            label="Note"
            htmlFor="note-text"
            error={invalid?.fieldId === "note-text" ? invalid.message : undefined}
          >
            <Textarea
              id="note-text"
              name="text"
              aria-invalid={invalid?.fieldId === "note-text" || undefined}
              aria-describedby={invalid?.fieldId === "note-text" ? "note-text-error" : undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field
            label="Detail we may share it for"
            htmlFor="note-field"
            hint="For example: your condition, your city."
            optional
          >
            <Input
              id="note-field"
              name="sharedField"
              autoComplete="off"
              aria-describedby="note-field-hint"
              value={sharedField}
              onChange={(event) => setSharedField(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" size="lg" loading={saving} loadingText="Saving">
              Save note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function orderGroups(documents: CaseDocument[]) {
  const groups = groupDocuments(documents);
  const rank = (kind: string) => {
    const at = GROUP_ORDER.indexOf(kind);
    return at === -1 ? GROUP_ORDER.length : at;
  };
  return [...groups].sort((a, b) => rank(a.kind) - rank(b.kind));
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

  const unique = dedupeDocuments(documents);
  const groups = orderGroups(unique);

  // The header action is the one primary; while loading or on error the page offers no action.
  const header = (action?: ReactNode) => (
    <PageHeader
      as={CASE_PAGE_HEADING}
      eyebrow="Documents"
      title="What we can use"
      lede="Facts and notes we may draw on. Your intake report is never sent."
      action={action}
    />
  );

  if (status === "loading") {
    return (
      <>
        {header()}
        <LoadingState label="Loading your documents">
          {[0, 1].map((key) => (
            <div key={key} className="grid gap-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ))}
        </LoadingState>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        {header()}
        <div
          role="alert"
          className="grid justify-items-start gap-3 rounded-lg border border-line bg-paper-2/60 p-6"
        >
          <h2 className="m-0 font-display text-h3 font-normal text-ink display-soft">
            We could not load your documents
          </h2>
          <p className="m-0 text-body text-ink-2">{message}</p>
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
      </>
    );
  }

  return (
    <div className="grid gap-10">
      {header(<AddNoteDialog caseId={caseId} onAdded={onAdded} />)}

      {preview ? (
        <p className="m-0 -mt-6 max-w-prose text-small text-ink-2">
          Sample list. The real one replaces it when it is ready.
        </p>
      ) : null}

      {status === "empty" ? (
        <EmptyState
          icon={<NotebookPen />}
          title="No documents yet"
          description="A note you add is used only for the detail you name. Your intake report is never sent."
        />
      ) : null}

      {groups.map((group) => (
        <DocumentGroup key={group.kind} kind={group.kind} items={group.items} all={documents} />
      ))}
    </div>
  );
}

const COLLAPSED_COUNT = 8;

function DocumentRows({ items, all }: { items: CaseDocument[]; all: CaseDocument[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);
  return (
    <>
      <List>
        {shown.map((document) => {
          const shared = sharedWith(sharedContactCount(all, document));
          const when = formatWhen(document.createdAt);
          return (
            <ListRow
              key={document.id}
              title={documentLabel(document)}
              meta={[plainSharingLine(document), when].filter(Boolean).join(" · ")}
              trailing={shared}
            />
          );
        })}
      </List>
      {items.length > COLLAPSED_COUNT ? (
        <div>
          <Button
            variant="link"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "Show fewer" : `Show all ${items.length}`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function DocumentGroup({
  kind,
  items,
  all,
}: {
  kind: string;
  items: CaseDocument[];
  all: CaseDocument[];
}) {
  const label = `${kindLabel(kind)} (${items.length})`;
  if (DISCLOSED_KINDS.has(kind)) {
    return (
      <section aria-label={kindLabel(kind)} className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <Details summary={label}>
          <DocumentRows items={items} all={all} />
        </Details>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={`docs-${kind}`}
      className="grid grid-cols-[minmax(0,1fr)] gap-3"
    >
      <h2
        id={`docs-${kind}`}
        className="m-0 max-w-none font-display text-h3 font-normal text-ink display-soft"
      >
        {kindLabel(kind)}
        <span className="ml-2 font-sans text-body font-normal text-ink-3">
          ({items.length})
        </span>
      </h2>
      <DocumentRows items={items} all={all} />
    </section>
  );
}
