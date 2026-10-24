"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Command } from "cmdk";
import { Check, CircleX, Search } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  JudgeOnly,
  Kbd,
  List,
  ListRow,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Textarea,
  TwoPane,
  WIDE_QUERY,
  useMediaQuery,
} from "@/components/ui";
import type { AgreementSummary, ReviewVerdict } from "./model";

export interface ReviewResource {
  id: string;
  targetKind: string;
  targetId: string;
  label: string;
  rank?: number;
  score?: number;
}

export interface ReviewSubmit {
  caseId: string;
  reviewer: string;
  targetKind: string;
  targetId: string;
  verdict: ReviewVerdict;
  note?: string;
}

export interface ReviewCheckpointProps {
  caseId: string;
  resources: ReviewResource[];
  agreement?: AgreementSummary[];
  onSubmit: (review: ReviewSubmit) => Promise<void>;
}

const KIND_LABEL: Record<string, string> = {
  expert: "Specialist",
  institution: "Center",
  trial: "Trial",
  organization: "Organization",
};

const SHORTCUTS: [string, string][] = [
  ["J / K", "next, previous"],
  ["C / X", "correct, incorrect"],
  ["N", "add a note"],
  ["Ctrl K", "jump to"],
];

const VERDICTS: { value: ReviewVerdict; title: string; description: string }[] = [
  { value: "correct", title: "Correct lead", description: "The right kind of resource for this case." },
  { value: "incorrect", title: "Incorrect lead", description: "Wrong kind, wrong place, or not supported by its sources." },
];

export function ReviewCheckpoint({ caseId, resources, agreement = [], onSubmit }: ReviewCheckpointProps) {
  const [reviewer, setReviewer] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, ReviewVerdict | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wide = useMediaQuery(WIDE_QUERY, true);

  const savedCount = resources.filter((resource) => saved[resource.id]).length;
  // Falls back to the first candidate while nothing (or a candidate that was re-ranked away) is selected.
  const selected = resources.find((resource) => resource.id === selectedId) ?? resources[0];

  const focusItem = useCallback((id: string) => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(id)}"]`);
    const target = row?.querySelector<HTMLElement>('[data-slot="list-row-target"]');
    target?.focus();
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  function select(resource: ReviewResource) {
    setSelectedId(resource.id);
    setError(null);
    setDetailOpen(true);
  }

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // One request per candidate, exactly the payload the per-candidate buttons used to send.
  function save(resource: ReviewResource) {
    const verdict = verdicts[resource.id];
    if (verdict !== "correct" && verdict !== "incorrect") {
      setError("Choose correct or incorrect before saving a review.");
      return;
    }
    if (!reviewer.trim()) {
      setError("Enter the reviewer name before saving.");
      return;
    }
    setError(null);
    setPending(resource.id);
    const note = notes[resource.id]?.trim();
    void onSubmit({
      caseId,
      reviewer: reviewer.trim(),
      targetKind: resource.targetKind,
      targetId: resource.targetId,
      verdict,
      note: note ? note : undefined,
    })
      .then(() => {
        setSaved((current) => ({ ...current, [resource.id]: true }));
        const next = resources[resources.findIndex((item) => item.id === resource.id) + 1];
        if (next) {
          setSelectedId(next.id);
          if (wide) focusItem(next.id);
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not save the review."))
      .finally(() => setPending(null));
  }

  // c / x / n act on the row that has focus (j / k movement comes from TwoPane). Never while typing in a field.
  function onListKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (event.metaKey || event.ctrlKey || event.altKey || target.getAttribute("data-slot") !== "list-row-target") return;
    const id = target.closest<HTMLElement>("[data-review-id]")?.dataset.reviewId;
    const resource = resources.find((item) => item.id === id);
    if (!resource) return;
    const key = event.key.toLowerCase();
    if (key === "c") setVerdicts((current) => ({ ...current, [resource.id]: "correct" }));
    else if (key === "x") setVerdicts((current) => ({ ...current, [resource.id]: "incorrect" }));
    else if (key === "n") {
      setSelectedId(resource.id);
      window.setTimeout(() => document.getElementById(`${resource.id}-note`)?.focus(), 0);
    } else return;
    event.preventDefault();
  }

  const list = (
    <div ref={listRef} onKeyDown={onListKey}>
      <List label="Candidates">
        {resources.map((resource) => (
          <ListRow
            key={resource.id}
            data-review-id={resource.id}
            title={resource.label}
            meta={
              <>
                {KIND_LABEL[resource.targetKind] ?? resource.targetKind}
                <JudgeOnly>
                  {resource.rank != null ? ` · rank ${resource.rank}` : ""}
                  {resource.score != null ? ` · score ${resource.score}` : ""}
                </JudgeOnly>
              </>
            }
            badges={
              saved[resource.id] ? (
                <Badge tone="ok">
                  <Check aria-hidden /> Saved
                </Badge>
              ) : null
            }
            selected={selected?.id === resource.id}
            onSelect={() => select(resource)}
          />
        ))}
      </List>
    </div>
  );

  const detail = selected ? (
    <form
      className="grid gap-5"
      aria-label={`Review ${selected.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        save(selected);
      }}
    >
      <div className="grid gap-1">
        <h3 className="m-0 font-display text-h3 font-normal text-ink text-balance">{selected.label}</h3>
        <p className="m-0 text-small text-ink-2">{KIND_LABEL[selected.targetKind] ?? selected.targetKind}</p>
      </div>
      <Field label="Reviewer name" htmlFor="reviewer-name">
        <Input id="reviewer-name" value={reviewer} autoComplete="name" onChange={(event) => setReviewer(event.target.value)} />
      </Field>
      <RadioGroup
        aria-label={`Verdict for ${selected.label}`}
        value={verdicts[selected.id] ?? ""}
        onValueChange={(value) => setVerdicts((current) => ({ ...current, [selected.id]: value as ReviewVerdict }))}
      >
        {VERDICTS.map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem value={option.value} id={`${selected.id}-${option.value}`} />
            <label htmlFor={`${selected.id}-${option.value}`} className="grid min-h-6 cursor-pointer gap-0.5">
              <span className="text-body font-semibold text-ink">{option.title}</span>
              <span className="text-small text-ink-2">{option.description}</span>
            </label>
          </div>
        ))}
      </RadioGroup>
      <Field label="Note" htmlFor={`${selected.id}-note`} optional>
        <Textarea
          id={`${selected.id}-note`}
          rows={3}
          className="min-h-20"
          value={notes[selected.id] ?? ""}
          onChange={(event) => setNotes((current) => ({ ...current, [selected.id]: event.target.value }))}
        />
      </Field>
      {error ? (
        <p role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={pending === selected.id} loadingText="Saving">
          Save review
        </Button>
      </div>
    </form>
  ) : null;

  return (
    <section aria-labelledby="review-title" className="grid gap-6">
      <header className="grid max-w-prose gap-2">
        <h3 id="review-title" className="m-0 font-display text-h3 font-normal text-ink text-balance">
          Review the candidates
        </h3>
        <p className="m-0 text-body text-ink-2 text-pretty">
          Mark whether each lead is the right kind of resource. This records a checkpoint. It does not contact anyone
          and it does not recommend a treatment.
        </p>
      </header>

      <div className="grid gap-3">
        <Progress
          value={savedCount}
          max={Math.max(resources.length, 1)}
          label="Reviewed"
          valueText={`${savedCount} of ${resources.length}`}
        />
        <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-small text-ink-2">
          {SHORTCUTS.map(([keys, what]) => (
            <span key={keys} className="inline-flex items-center gap-1.5">
              <Kbd>{keys}</Kbd> {what}
            </span>
          ))}
        </p>
      </div>

      {resources.length === 0 ? (
        <EmptyState
          title="No stored candidates to review yet"
          description="When research has ranked resources for this case, each one appears here to mark correct or incorrect."
          action={
            <Button asChild variant="link" className="min-h-11">
              <Link href={`/cases/${caseId}/shortlist`}>Open the shortlist</Link>
            </Button>
          }
        />
      ) : (
        <TwoPane
          list={list}
          listLabel="Candidates"
          detail={detail}
          detailLabel="Review form"
          detailTitle={selected?.label}
          detailOpen={detailOpen}
          onDetailOpenChange={setDetailOpen}
        />
      )}

      {agreement.length > 0 ? (
        <section aria-labelledby="agreement-title" className="grid gap-3 border-t border-line pt-6">
          <h3 id="agreement-title" className="m-0 font-display text-h3 font-normal text-ink text-balance">
            Agreement by resource kind
          </h3>
          <List label="Agreement by resource kind">
            {agreement.map((row) => (
              <ListRow
                key={row.targetKind}
                title={KIND_LABEL[row.targetKind] ?? row.targetKind}
                trailing={<span className="font-semibold tabular-nums text-ink">{Math.round(row.agreementRate * 100)}%</span>}
                meta={
                  <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1">
                      <Check aria-hidden className="size-4 text-ok" /> {row.correct} correct
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CircleX aria-hidden className="size-4 text-danger" /> {row.incorrect} incorrect
                    </span>
                  </span>
                }
              >
                <Progress value={row.correct} max={row.total} tone="ok" aria-label={`Agreement for ${KIND_LABEL[row.targetKind] ?? row.targetKind}`} />
              </ListRow>
            ))}
          </List>
        </section>
      ) : null}

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="max-w-xl gap-0 p-0 sm:p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Jump to a resource</DialogTitle>
            <DialogDescription>Type to search the resources in this review.</DialogDescription>
          </DialogHeader>
          <Command label="Jump to a resource" className="grid">
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search aria-hidden className="size-5 shrink-0 text-ink-3" />
              <Command.Input
                placeholder="Jump to a resource"
                className="h-14 w-full rounded-none border-0 bg-transparent pr-10 text-body text-ink shadow-none outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-4 py-6 text-center text-small text-ink-2">No resource matches.</Command.Empty>
              {resources.map((resource) => (
                <Command.Item
                  key={resource.id}
                  value={`${resource.label} ${KIND_LABEL[resource.targetKind] ?? ""}`}
                  onSelect={() => {
                    setPaletteOpen(false);
                    setSelectedId(resource.id);
                    window.setTimeout(() => focusItem(resource.id), 50);
                  }}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-body text-ink data-[selected=true]:bg-teal-soft"
                >
                  <span className="min-w-0 truncate">{resource.label}</span>
                  <span className="shrink-0 text-small text-ink-2">
                    {saved[resource.id] ? "Saved" : (KIND_LABEL[resource.targetKind] ?? resource.targetKind)}
                  </span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </section>
  );
}
