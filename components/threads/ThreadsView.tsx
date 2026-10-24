"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Mail, PhoneCall, TriangleAlert } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { contactLabel, readStoredOutreach, type ApiContact } from "@/components/outreach/client";
import { formatWhen, titleCase } from "@/components/outreach/format";
import { DisclosureLine } from "@/components/outreach/LetterSheet";
import { splitDisclosure } from "@/components/outreach/letter";
import { TaskCard } from "@/components/outreach/TaskCard";
import { cn } from "@/lib/ui/cn";
import { loadThreads } from "./load";
import { CLINICAL_NOTICE, disclosureFor, fieldLabel, type ContactThread, type ThreadEntry } from "./model";
import { EmptyState, ErrorState, LoadingSkeleton } from "./states";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; threads: ContactThread[] };

export function ThreadsView({ caseId, focusContactId }: { caseId: string; focusContactId: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadThreads(caseId).then((result) => {
      if (!active) return;
      setContacts(readStoredOutreach(caseId)?.contacts ?? []);
      if (result.status === "unavailable") setPhase({ kind: "unavailable" });
      else if (result.status === "error" || !result.threads) setPhase({ kind: "error" });
      else setPhase({ kind: "ready", threads: result.threads });
    });
    return () => {
      active = false;
    };
  }, [caseId, attempt]);

  if (phase.kind === "loading") return <LoadingSkeleton label="Loading conversations" />;

  if (contacts.length === 0 && (phase.kind === "unavailable" || (phase.kind === "ready" && phase.threads.length === 0))) {
    return (
      <EmptyState
        title="No conversations yet"
        detail="Choose who to contact and save consent. A thread appears here as soon as a message is drafted."
        actionHref={`/cases/${caseId}/consent`}
        actionLabel="Open consent"
      />
    );
  }

  if (phase.kind === "error") {
    return (
      <ErrorState
        title="Conversations could not be loaded"
        detail="The thread list did not come back. Nothing was sent."
        onRetry={() => {
          setPhase({ kind: "loading" });
          setAttempt((value) => value + 1);
        }}
        actionHref={`/cases/${caseId}/tracker`}
        actionLabel="Back to the tracker"
      />
    );
  }

  const threads = phase.kind === "ready" ? phase.threads : [];
  const people: { id: string; label: string; channel: "email" | "voice" | null }[] =
    contacts.length > 0
      ? contacts.map((item) => ({ id: item.id, label: titleCase(contactLabel(item)), channel: item.channel }))
      : threads.map((item) => ({ id: item.contactId, label: item.label, channel: null }));
  const shownId = focusContactId && people.some((p) => p.id === focusContactId) ? focusContactId : (people[0]?.id ?? null);
  const contact = contacts.find((item) => item.id === shownId) ?? null;
  const thread = threads.find((item) => item.contactId === shownId) ?? null;
  const shownLabel = people.find((p) => p.id === shownId)?.label ?? "Conversation";

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
      <nav aria-label="Contacts" className="lg:sticky lg:top-28 lg:self-start">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0 lg:flex-col lg:gap-1">
          {people.map((person) => {
            const active = person.id === shownId;
            return (
              <li key={person.id} className="min-w-0 max-w-full lg:w-full">
                <Link
                  href={`/cases/${caseId}/threads?contact=${encodeURIComponent(person.id)}`}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-md border px-3 text-small font-semibold no-underline focus-ring",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    active
                      ? "border-teal/50 bg-teal-soft text-teal-ink dark:text-teal"
                      : "border-line bg-card text-ink-2 hover:border-line-strong hover:text-ink",
                  )}
                >
                  {person.channel === "voice" ? (
                    <PhoneCall aria-hidden className="size-4 shrink-0" />
                  ) : (
                    <Mail aria-hidden className="size-4 shrink-0" />
                  )}
                  <span className="min-w-0 break-words">{person.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <section aria-labelledby="thread-heading" className="grid min-w-0 content-start gap-6">
        <div className="grid gap-1">
          <h3 id="thread-heading" className="m-0 break-words font-display text-h2 font-light text-ink display-soft">
            {shownLabel}
          </h3>
          {contact ? (
            <p className="m-0 break-words text-small text-ink-2">
              {contact.channel === "email" ? "Email" : "Phone"} · {contact.address}
            </p>
          ) : null}
        </div>

        {phase.kind === "unavailable" ? (
          <p role="status" className="m-0 rounded-md bg-paper-2 p-4 text-small text-ink-2 shadow-inset">
            Conversation history is not connected yet, so only your saved contacts are listed. Drafts waiting on you
            are in the{" "}
            <Link href={`/cases/${caseId}/outbox`} className="font-semibold text-teal underline underline-offset-4 focus-ring">
              outbox
            </Link>
            .
          </p>
        ) : null}

        {!thread || thread.entries.length === 0 ? (
          <EmptyState
            title="No messages in this thread yet"
            detail="Approved emails, replies and call transcripts show up here, in order."
            actionHref={`/cases/${caseId}/outbox`}
            actionLabel="Open the outbox"
          />
        ) : (
          <ol className="m-0 grid list-none gap-6 p-0">
            {thread.entries.map((entry) => (
              <li key={entry.id}>
                <ThreadItem entry={entry} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ThreadItem({ entry }: { entry: ThreadEntry }) {
  const outbound = entry.direction === "outbound";
  const voice = entry.channel === "voice";
  const disclosure = disclosureFor(entry);
  const heading = voice ? (outbound ? "Call script" : "Call transcript") : outbound ? "Email you approved" : "Their reply";
  const Direction = outbound ? ArrowUpRight : ArrowDownLeft;
  const segments = splitDisclosure(entry.body);
  return (
    <article
      data-direction={entry.direction}
      data-channel={entry.channel}
      aria-label={heading}
      className={cn("grid gap-4", outbound ? "sm:pl-10" : "sm:pr-10")}
    >
      <Card variant={outbound ? "raised" : "inset"} padding="md" radius="md" className={outbound ? "border-l-2 border-l-teal" : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <Direction aria-hidden className="size-4" />
            {heading}
          </span>
          <span>{formatWhen(entry.at, "Time not recorded")}</span>
        </div>
        {entry.subject ? (
          <p className="m-0 mb-2 break-words font-display text-h4 font-normal text-ink display-soft">{entry.subject}</p>
        ) : null}
        <div className={cn("grid gap-3 text-body text-ink", voice && "border-l border-line-strong pl-4 italic")}>
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
        {outbound ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-small text-ink-2">
            <span className="font-semibold text-ink">Shared:</span>
            {entry.sharedFields.length > 0 ? (
              entry.sharedFields.map((field) => (
                <Badge key={field} tone="sage">
                  {fieldLabel(field)}
                </Badge>
              ))
            ) : (
              <span>none listed</span>
            )}
          </div>
        ) : null}
        {outbound && !disclosure ? (
          <p className="m-0 mt-3 flex items-start gap-2 text-small text-warn-ink">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            The AI-assistance disclosure was not found in this message.
          </p>
        ) : null}
        {entry.clinical ? (
          <p role="note" className="m-0 mt-4 flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft p-4 text-body text-warn-ink">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {CLINICAL_NOTICE}
          </p>
        ) : null}
        {entry.classification ? (
          <p className="m-0 mt-4 text-small text-ink-2">
            <Badge tone="teal" className="mr-2">
              {entry.classification.label}
            </Badge>
            {entry.classification.rationale}
          </p>
        ) : null}
      </Card>
      {entry.task ? (
        <div className="sm:pl-6">
          <TaskCard task={entry.task} />
        </div>
      ) : null}
    </article>
  );
}

