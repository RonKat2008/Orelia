"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ClipboardList, TriangleAlert } from "lucide-react";
import { JudgeOnly, Surface } from "@/components/ui";
import { formatWhen } from "@/components/outreach/format";
import { DisclosureLine } from "@/components/outreach/LetterSheet";
import { splitDisclosure } from "@/components/outreach/letter";
import { TASK_KIND_LABELS } from "@/components/outreach/types";
import { cn } from "@/lib/ui/cn";
import { CLINICAL_NOTICE, disclosureFor, fieldLabel, type ContactThread, type ThreadEntry } from "./model";
import { ErrorState, LoadingSkeleton } from "./states";

/** Where the case's thread list stands. "unavailable" means the threads API is not connected yet. */
export type ThreadsStatus = "loading" | "ok" | "unavailable" | "error";

/**
 * One contact's conversation, as the "Conversation" part of the tracker's detail pane (docs/DESIGN-v2.md 7.10):
 * messages you approved, their replies and call transcripts, in order, each in a quiet well. Requests a contact made
 * show here as one line; the request itself (with its approve action) shows once, in the pane's "Needs you" part.
 */
export function ContactThreadView({
  caseId,
  status,
  thread,
  onRetry,
}: {
  caseId: string;
  status: ThreadsStatus;
  thread: ContactThread | null;
  onRetry: () => void;
}) {
  if (status === "loading") return <LoadingSkeleton label="Loading the conversation" />;
  if (status === "error") {
    return (
      <ErrorState
        title="The conversation could not be loaded"
        detail="The message history did not come back. Nothing was sent."
        onRetry={onRetry}
      />
    );
  }
  if (status === "unavailable") {
    return (
      <p role="status" className="m-0 rounded-md bg-paper-2 p-4 text-small text-ink-2">
        Message history is not connected yet. Drafts waiting on you are in the{" "}
        <Link href={`/cases/${caseId}/outbox`} className="font-semibold text-teal-ink underline underline-offset-4 focus-ring dark:text-teal">
          outbox
        </Link>
        .
      </p>
    );
  }
  if (!thread || thread.entries.length === 0) {
    return (
      <p className="m-0 text-small text-ink-2">
        Nothing sent yet. Sent messages, replies and call transcripts will show here, in order.
      </p>
    );
  }
  return (
    <ol className="m-0 grid list-none gap-4 p-0">
      {thread.entries.map((entry) => (
        <li key={entry.id}>
          <ThreadItem entry={entry} />
        </li>
      ))}
    </ol>
  );
}

const TASK_STATUS_WORD = { open: "waiting for you", approved: "approved", done: "done" } as const;

export function ThreadItem({ entry }: { entry: ThreadEntry }) {
  const outbound = entry.direction === "outbound";
  const voice = entry.channel === "voice";
  const disclosure = disclosureFor(entry);
  const heading = voice ? (outbound ? "Call script" : "Call transcript") : outbound ? "Email you approved" : "Their reply";
  const Direction = outbound ? ArrowUpRight : ArrowDownLeft;
  const segments = splitDisclosure(entry.body);
  return (
    <article data-direction={entry.direction} data-channel={entry.channel} aria-label={heading} className="grid gap-2">
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
        <span className="flex items-center gap-1 font-semibold text-ink">
          <Direction aria-hidden className="size-4 shrink-0" />
          {heading}
        </span>
        <span>{formatWhen(entry.at, "Time not recorded")}</span>
      </p>
      <Surface variant="well" radius="md" padding="sm" className={cn("grid gap-3", outbound && "border-l-2 border-l-teal/60")}>
        {entry.subject ? <p className="m-0 break-words font-semibold text-ink">{entry.subject}</p> : null}
        <div className={cn("grid gap-3 text-body text-ink", voice && "italic")}>
          {segments.map((segment, index) =>
            segment.kind === "disclosure" ? (
              <DisclosureLine key={index}>{segment.text}</DisclosureLine>
            ) : (
              <p key={index} className="m-0 whitespace-pre-wrap break-words">
                {segment.text.trim()}
              </p>
            ),
          )}
        </div>
      </Surface>
      {outbound ? (
        <p className="m-0 break-words text-small text-ink-2">
          <span className="font-semibold text-ink">Shared:</span>{" "}
          {entry.sharedFields.length > 0 ? entry.sharedFields.map(fieldLabel).join(", ") : "none listed"}
        </p>
      ) : null}
      {outbound && !disclosure ? (
        <p className="m-0 flex items-start gap-2 text-small text-warn-ink">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          The AI-assistance disclosure was not found in this message.
        </p>
      ) : null}
      {entry.clinical ? (
        <p role="note" className="m-0 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft p-4 text-body text-warn-ink">
          <TriangleAlert aria-hidden className="mt-1 size-4 shrink-0" />
          {CLINICAL_NOTICE}
        </p>
      ) : null}
      {entry.classification ? (
        <JudgeOnly>
          <p className="m-0 break-words text-small text-ink-2">
            <span className="font-semibold text-ink">Read as: {entry.classification.label}.</span> {entry.classification.rationale}
          </p>
        </JudgeOnly>
      ) : null}
      {entry.task ? (
        <p className="m-0 flex items-start gap-2 text-small text-ink-2" data-task-ref={entry.task.id}>
          <ClipboardList aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            They asked: <span className="font-semibold text-ink">{TASK_KIND_LABELS[entry.task.kind]}</span>, {TASK_STATUS_WORD[entry.task.status]}.
          </span>
        </p>
      ) : null}
    </article>
  );
}
