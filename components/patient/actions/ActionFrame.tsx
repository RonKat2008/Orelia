"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { ActionCard } from "@/components/ui";
import { PATIENT_HOME_COPY } from "../copy";

export interface ActionFrameProps {
  title: ReactNode;
  /** At most one sentence. */
  lede?: ReactNode;
  /** The detailed page for this step; shown as a quiet "See details" link. */
  detailsHref?: string;
  children?: ReactNode;
  kind: string;
  /** Heading level of the card title. Default h2 (the page h1 sits above the card). */
  titleAs?: "h1" | "h2" | "h3";
  /** The view's one primary Button (size="lg"). */
  action?: ReactNode;
  /** At most one quiet alternative (a link-variant Button). */
  secondaryAction?: ReactNode;
  /** One short line under the button. Say it once per screen. */
  reassurance?: ReactNode;
}

const QUIET_LINK =
  "rounded-sm text-small font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink focus-ring";

/**
 * The one "do this now" card on the patient case home, built on the lane A ActionCard (2 px teal top edge, raised).
 * Callers may pass the controls as children (older cards) or use the action / secondaryAction / reassurance slots.
 */
export function ActionFrame({
  title,
  lede,
  detailsHref,
  children,
  kind,
  titleAs = "h2",
  action,
  secondaryAction,
  reassurance,
}: ActionFrameProps) {
  const details = detailsHref ? (
    <Link href={detailsHref} className={QUIET_LINK}>
      {PATIENT_HOME_COPY.seeDetails}
    </Link>
  ) : null;
  const secondary = secondaryAction ?? details;
  const footer = secondaryAction && details ? <>{reassurance ? <>{reassurance} </> : null}{details}</> : reassurance;
  return (
    <ActionCard
      data-testid="patient-action"
      data-action={kind}
      title={title}
      titleAs={titleAs}
      lede={lede}
      action={action}
      secondaryAction={secondary}
      reassurance={footer}
    >
      {children}
    </ActionCard>
  );
}

/**
 * Problems from a save or load, shown like the lane A ErrorSummary ("There is a problem") and taking focus when they
 * appear. These messages are not tied to one field, so they are plain items rather than links.
 */
export function ActionError({ messages, title = PATIENT_HOME_COPY.errorTitle }: { messages: string[]; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const signature = messages.join("|");
  useEffect(() => {
    if (signature) ref.current?.focus();
  }, [signature]);
  if (messages.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-slot="error-summary"
      className="grid gap-3 rounded-md border-2 border-danger bg-card p-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <h3 className="m-0 flex items-center gap-2 text-body font-semibold text-ink">
        <CircleAlert aria-hidden className="size-5 shrink-0 text-danger" />
        {title}
      </h3>
      <ul className="m-0 grid list-none gap-2 p-0">
        {messages.map((message) => (
          <li key={message} className="text-body text-ink [overflow-wrap:anywhere]">
            {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ActionProps {
  caseId: string;
  onDone: () => Promise<void>;
}
