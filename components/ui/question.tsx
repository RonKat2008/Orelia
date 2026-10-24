"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";
import { Button } from "./button";
import { ErrorSummary, type ErrorSummaryItem } from "./error-summary";

export interface QuestionControlProps {
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface QuestionProps {
  /** The question, which is also the page heading ("What is your city?"). */
  question: ReactNode;
  /** Heading level for the question. Default h1 (one question per page). */
  questionAs?: "h1" | "h2";
  /**
   * "field": one control; the question is its <label> (pass `controlId`, the input's id).
   * "fieldset": radios or checkboxes; the question is the <legend>.
   */
  kind?: "field" | "fieldset";
  /** Id of the single control (kind="field"). */
  controlId?: string;
  /** At most one short sentence. */
  hint?: ReactNode;
  /** Mark "(optional)" after the question instead of an asterisk. */
  optional?: boolean;
  /** Error by the field: problem plus fix. Set after Continue only (R27). */
  error?: string;
  /** All errors on this page, for the summary at the top. Defaults to `error` on `controlId`. */
  errors?: ErrorSummaryItem[];
  /**
   * The control(s). Pass a function to receive the wiring for a single control:
   * `{(q) => <Input id="city" {...q} />}` spreads `aria-describedby` and `aria-invalid`.
   */
  children: ReactNode | ((control: QuestionControlProps) => ReactNode);
  /** Back link above the question (a BackLink). Every question page has one. */
  back?: ReactNode;
  /** Continue button label: verb + object ("Continue", "Save and continue"). Never disabled. */
  submitLabel?: string;
  /** Validate here and set `error`; keep what the user typed. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Busy state for the submit button. */
  submitting?: boolean;
  /** One quiet alternative under the button ("Upload a report instead"). */
  secondary?: ReactNode;
  className?: string;
}

/**
 * Question: one question per page (R1, R2, R27, R28, R29). Back link, error summary, the question as the heading
 * (label or legend), at most one hint, the control, then a never-disabled Continue. Validation runs on submit.
 * With kind="fieldset" the hint and error describe the fieldset; with kind="field" pass children as a function to
 * wire them onto the control.
 */
export function Question({
  question,
  questionAs: Heading = "h1",
  kind = "field",
  controlId,
  hint,
  optional = false,
  error,
  errors,
  children,
  back,
  submitLabel = "Continue",
  onSubmit,
  submitting = false,
  secondary,
  className,
}: QuestionProps) {
  const fallbackId = useId();
  const baseId = controlId ?? fallbackId;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const summary = errors ?? (error ? [{ fieldId: baseId, message: error }] : []);
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const control: QuestionControlProps = { "aria-describedby": describedBy, "aria-invalid": error ? true : undefined };
  const body = typeof children === "function" ? children(control) : children;

  const questionText = (
    <>
      {question}
      {optional ? <span className="font-sans text-body font-normal text-ink-2"> (optional)</span> : null}
    </>
  );
  const headingClass = "m-0 max-w-none font-display text-h1 font-light text-ink display-soft text-balance";

  const messages = (
    <>
      {hint ? (
        <p id={hintId} className="m-0 max-w-prose text-body text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="m-0 text-body font-semibold text-danger">
          <span className="sr-only">Error: </span>
          {error}
        </p>
      ) : null}
    </>
  );

  return (
    <form
      noValidate
      data-slot="question"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(event);
      }}
      className={cn("grid max-w-patient gap-6", className)}
    >
      {back ? <div>{back}</div> : null}
      <ErrorSummary errors={summary} />
      {kind === "fieldset" ? (
        <fieldset
          id={controlId}
          aria-describedby={describedBy}
          className={cn("m-0 grid min-w-0 gap-4 border-0 p-0", error && "border-l-4 border-solid border-danger pl-4")}
        >
          <legend className="mb-4 p-0">
            <Heading className={headingClass}>{questionText}</Heading>
          </legend>
          {messages}
          {body}
        </fieldset>
      ) : (
        <div className={cn("grid gap-4", error && "border-l-4 border-danger pl-4")}>
          <Heading className={headingClass}>
            <label htmlFor={baseId}>{questionText}</label>
          </Heading>
          {messages}
          {body}
        </div>
      )}
      <div className="grid gap-4">
        <div>
          <Button type="submit" size="lg" loading={submitting}>
            {submitLabel}
          </Button>
        </div>
        {secondary}
      </div>
    </form>
  );
}

export interface SummaryListRow {
  /** What the answer is about ("Your city"). */
  label: ReactNode;
  /** The answer. Empty values render "Not provided". */
  value?: ReactNode;
  /** Where "Change" goes (a question page), or a handler. */
  changeHref?: string;
  onChange?: () => void;
  /** Visually hidden suffix for the Change link, e.g. "your city". Defaults to the label when it is a string. */
  changeLabel?: string;
}

export interface SummaryListProps {
  rows: SummaryListRow[];
  className?: string;
}

const CHANGE = "rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring";

/** SummaryList: the check-answers list (R4) as a <dl>, one row per answer with a Change link. */
export function SummaryList({ rows, className }: SummaryListProps) {
  return (
    <dl data-slot="summary-list" className={cn("m-0 border-t border-line", className)}>
      {rows.map((row, index) => {
        const hidden = row.changeLabel ?? (typeof row.label === "string" ? row.label.toLowerCase() : undefined);
        const empty = row.value === undefined || row.value === null || row.value === "";
        const change = row.changeHref ? (
          <Link href={row.changeHref} className={CHANGE}>
            Change{hidden ? <span className="sr-only"> {hidden}</span> : null}
          </Link>
        ) : row.onChange ? (
          <button type="button" data-slot="summary-change" onClick={row.onChange} className={cn(CHANGE, "cursor-pointer")}>
            Change{hidden ? <span className="sr-only"> {hidden}</span> : null}
          </button>
        ) : null;
        return (
          <div
            key={typeof row.label === "string" ? row.label : index}
            className="grid gap-1 border-b border-line py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:gap-6"
          >
            <dt className="text-body font-semibold text-ink">{row.label}</dt>
            <dd className={cn("m-0 text-body", empty ? "text-ink-2" : "text-ink")}>{empty ? "Not provided" : row.value}</dd>
            {change ? <dd className="m-0">{change}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}
