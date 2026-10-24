"use client";

import type { ReactNode } from "react";
import { JudgeOnly, PageHeader } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

/**
 * Heading level for case sub-page titles. The case shell prints no h1 (lane A part 2), so each page title is the h1.
 */
export const CASE_PAGE_HEADING = "h1" as "h1" | "h2";
/** Section headings under the page title (one level below it). */
export const CASE_SECTION_HEADING = CASE_PAGE_HEADING === "h1" ? "h2" : "h3";
/** Sub-section headings (two levels below the page title). */
export const CASE_SUB_HEADING = CASE_PAGE_HEADING === "h1" ? "h3" : "h4";

export interface CasePageProps {
  /** One line, no `emph`. */
  title: ReactNode;
  /** At most one sentence (docs/DESIGN-v2.md 6, PageHeader). */
  lede?: ReactNode;
  /** Judge-only eyebrow (hidden in patient view by PageHeader). */
  eyebrow?: ReactNode;
  /** The page's one primary action, when it belongs in the header (judge view). */
  action?: ReactNode;
  /**
   * LANE C SWITCH POINT. The patient variant of this page (components/patient/views/**). When given, patient view
   * renders it instead of `children`, and the judge view renders the header and `children`. When omitted, both views
   * render `children`, with judge-only blocks wrapped in <JudgeOnly> inside them.
   */
  patient?: ReactNode;
  /** Judge console width (two panes) or the 52rem wide column for pages without a list. */
  width?: "judge" | "wide";
  children: ReactNode;
  className?: string;
}

/**
 * CasePage: content frame for the lane D case pages (swarm, shortlist, consent, plan, outbox, tracker, threads,
 * coordinate, review). Replaces OutreachNav: one PageHeader, no pill row (the stage bar in the case shell is the one
 * navigation system, docs/DESIGN-v2.md 5.3).
 */
export function CasePage({ title, lede, eyebrow, action, patient, width = "judge", children, className }: CasePageProps) {
  const body = (
    <section
      data-slot="case-page"
      className={cn("ds-root grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8", width === "wide" ? "max-w-wide" : "max-w-judge", className)}
    >
      <PageHeader as={CASE_PAGE_HEADING} title={title} lede={lede} eyebrow={eyebrow} action={action} className="mb-0" />
      {children}
    </section>
  );
  if (patient === undefined) return body;
  return <JudgeOnly fallback={patient}>{body}</JudgeOnly>;
}
