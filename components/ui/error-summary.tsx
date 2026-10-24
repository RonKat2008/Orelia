"use client";

import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/ui/cn";

export interface ErrorSummaryItem {
  /** Id of the field with the problem (no leading #). */
  fieldId: string;
  /** Problem plus fix, e.g. "Tell us your city, or choose Skip". No "please", "sorry", "invalid" or "oops". */
  message: string;
}

export interface ErrorSummaryProps {
  errors: ErrorSummaryItem[];
  /** Default "There is a problem". */
  title?: ReactNode;
  /** Optional one-line context under the title. */
  description?: ReactNode;
  /** Move focus to the summary when it appears or the errors change (default true). */
  autoFocus?: boolean;
  className?: string;
}

function focusField(event: MouseEvent<HTMLAnchorElement>, fieldId: string) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  event.preventDefault();
  // A fieldset's first control is the useful target (radio groups).
  const target =
    field.matches("input, textarea, select, button, [tabindex]")
      ? field
      : field.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]") ?? field;
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
}

/**
 * ErrorSummary (R28): shown at the top of a form after Continue, never on blur. Heading "There is a problem", a list
 * of links to each field, and focus moves to it. Repeat each message by its field (Field `error`). Red is used only
 * here and on the field.
 */
export function ErrorSummary({ errors, title = "There is a problem", description, autoFocus = true, className }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = errors.map((error) => `${error.fieldId}:${error.message}`).join("|");

  useEffect(() => {
    if (autoFocus && signature) ref.current?.focus();
  }, [autoFocus, signature]);

  if (errors.length === 0) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-slot="error-summary"
      className={cn("grid gap-3 rounded-md border-2 border-danger bg-card p-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
    >
      <h2 className="m-0 flex items-center gap-2 text-body font-semibold text-ink">
        <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
        {title}
      </h2>
      {description ? <p className="m-0 text-body text-ink-2">{description}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => focusField(event, error.fieldId)}
              className="rounded-sm text-body font-semibold text-danger underline underline-offset-4 focus-ring"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
