"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Command } from "cmdk";
import { Check, CircleX, Search } from "lucide-react";
import {
  Badge,
  Button,
  ChoiceRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Kbd,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Textarea,
} from "@/components/ui";
import { cn } from "@/lib/ui/cn";
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
  ["Enter", "save"],
  ["Ctrl K", "jump to"],
];

export function ReviewCheckpoint({ caseId, resources, agreement = [], onSubmit }: ReviewCheckpointProps) {
  const [reviewer, setReviewer] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, ReviewVerdict | "">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const savedCount = resources.filter((resource) => saved[resource.id]).length;

  const focusItem = useCallback((id: string) => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(id)}"]`);
    node?.focus();
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

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
        if (next) focusItem(next.id);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not save the review."))
      .finally(() => setPending(null));
  }

  function onItemKey(event: KeyboardEvent<HTMLElement>, resource: ReviewResource, index: number) {
    // Shortcuts only fire from the card itself, never while typing in a field.
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const go = (offset: number) => {
      const target = resources[index + offset];
      if (target) focusItem(target.id);
    };
    if (key === "j" || key === "arrowdown") go(1);
    else if (key === "k" || key === "arrowup") go(-1);
    else if (key === "c") setVerdicts((current) => ({ ...current, [resource.id]: "correct" }));
    else if (key === "x") setVerdicts((current) => ({ ...current, [resource.id]: "incorrect" }));
    else if (key === "n") document.getElementById(`${resource.id}-note`)?.focus();
    else if (key === "enter") save(resource);
    else return;
    event.preventDefault();
  }

  return (
    <section aria-labelledby="review-title" className="grid gap-8">
      <header className="grid gap-3">
        <h2 id="review-title" className="m-0 font-display text-h2 font-light text-ink display-soft">
          Specialist <em className="emph">review</em>
        </h2>
        <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
          Mark whether each shortlisted resource is the right kind of lead. This records a checkpoint for evaluation.
          It does not contact anyone and it does not recommend a treatment.
        </p>
      </header>

      <div className="grid gap-5 rounded-lg border border-line bg-card p-5 shadow-xs sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-end">
        <Field label="Reviewer name" htmlFor="reviewer-name">
          <Input id="reviewer-name" value={reviewer} autoComplete="name" onChange={(event) => setReviewer(event.target.value)} />
        </Field>
        <div className="grid gap-3">
          <Progress
            value={savedCount}
            max={Math.max(resources.length, 1)}
            label="Reviewed"
            valueText={`${savedCount} of ${resources.length}`}
          />
          <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-small text-ink-3">
            {SHORTCUTS.map(([keys, what]) => (
              <span key={keys} className="inline-flex items-center gap-1.5">
                <Kbd>{keys}</Kbd> {what}
              </span>
            ))}
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="m-0 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-small font-semibold text-danger">
          {error}
        </p>
      ) : null}

      {resources.length === 0 ? (
        <EmptyState
          title="No stored candidates to review yet"
          description="When research has ranked resources for this case, each one appears here to mark correct or incorrect."
          action={
            <Button asChild variant="secondary">
              <Link href={`/cases/${caseId}/shortlist`}>Open the shortlist</Link>
            </Button>
          }
        />
      ) : (
        <div ref={listRef} className="grid gap-5">
          {resources.map((resource, index) => {
            const verdict = verdicts[resource.id] ?? "";
            const isSaved = saved[resource.id];
            return (
              <article
                key={resource.id}
                data-review-id={resource.id}
                tabIndex={0}
                aria-label={`${resource.label}, ${KIND_LABEL[resource.targetKind] ?? resource.targetKind}`}
                onKeyDown={(event) => onItemKey(event, resource, index)}
                className={cn(
                  "grid gap-5 rounded-lg border bg-card p-5 shadow-xs focus-ring sm:p-6",
                  "transition-[border-color,box-shadow] duration-300 ease-out-expo motion-reduce:transition-none",
                  isSaved ? "border-ok/40" : "border-line focus-within:border-teal/50 focus:shadow-md",
                )}
              >
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 gap-1">
                    <p className="m-0 text-micro font-semibold uppercase text-ink-3">
                      {KIND_LABEL[resource.targetKind] ?? resource.targetKind}
                      {resource.rank != null ? ` · rank ${resource.rank}` : ""}
                      {resource.score != null ? ` · score ${resource.score}` : ""}
                    </p>
                    <h3 className="m-0 max-w-none font-display text-h3 font-normal text-ink display-soft text-balance">
                      {resource.label}
                    </h3>
                  </div>
                  {isSaved ? (
                    <Badge tone="ok">
                      <Check aria-hidden /> Saved
                    </Badge>
                  ) : null}
                </header>
                <RadioGroup
                  aria-label={`Verdict for ${resource.label}`}
                  value={verdict}
                  onValueChange={(value) => setVerdicts((current) => ({ ...current, [resource.id]: value as ReviewVerdict }))}
                  className="sm:grid-cols-2"
                >
                  <ChoiceRow title="Correct lead" description="The right kind of resource for this case.">
                    <RadioGroupItem value="correct" id={`${resource.id}-correct`} />
                  </ChoiceRow>
                  <ChoiceRow title="Incorrect lead" description="Wrong kind, wrong place, or not supported by its sources.">
                    <RadioGroupItem value="incorrect" id={`${resource.id}-incorrect`} />
                  </ChoiceRow>
                </RadioGroup>
                <Field label="Note" htmlFor={`${resource.id}-note`} optional>
                  <Textarea
                    id={`${resource.id}-note`}
                    rows={2}
                    className="min-h-20"
                    value={notes[resource.id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [resource.id]: event.target.value }))}
                  />
                </Field>
                <div>
                  <Button
                    type="button"
                    loading={pending === resource.id}
                    loadingText="Saving"
                    variant={isSaved ? "secondary" : "primary"}
                    onClick={() => save(resource)}
                  >
                    {isSaved ? "Save again" : "Save review"}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {agreement.length > 0 ? (
        <section aria-labelledby="agreement-title" className="grid gap-4 border-t border-line pt-8">
          <h3 id="agreement-title" className="m-0 font-display text-h3 font-normal text-ink display-soft">
            Agreement by resource kind
          </h3>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {agreement.map((row) => (
              <li key={row.targetKind} className="grid gap-2 rounded-md border border-line bg-card p-4">
                <p className="m-0 flex items-baseline justify-between gap-3 text-body">
                  <span className="font-semibold text-ink">{KIND_LABEL[row.targetKind] ?? row.targetKind}</span>
                  <span className="font-display text-h4 tabular-nums text-teal">{Math.round(row.agreementRate * 100)}%</span>
                </p>
                <Progress value={row.correct} max={row.total} tone="ok" />
                <p className="m-0 flex items-center gap-3 text-small text-ink-2">
                  <span className="inline-flex items-center gap-1"><Check aria-hidden className="size-4 text-ok" /> {row.correct} correct</span>
                  <span className="inline-flex items-center gap-1"><CircleX aria-hidden className="size-4 text-danger" /> {row.incorrect} incorrect</span>
                </p>
              </li>
            ))}
          </ul>
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
                    window.setTimeout(() => focusItem(resource.id), 50);
                  }}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-body text-ink data-[selected=true]:bg-teal-soft"
                >
                  <span className="min-w-0 truncate">{resource.label}</span>
                  <span className="shrink-0 text-small text-ink-3">
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
