"use client";

import { useEffect, useState } from "react";
import { approveTask, contactLabel, readStoredOutreach, type ApiContact } from "@/components/outreach/client";
import { TASK_KIND_LABELS } from "@/components/outreach/types";
import { loadThreads } from "./load";
import { CLINICAL_NOTICE, disclosureFor, fieldLabel, type ContactThread, type ThreadEntry, type ThreadTask } from "./model";
import { EmptyState, ErrorState, LoadingSkeleton } from "./states";
import "./threads.css";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; threads: ContactThread[] };

function formatWhen(iso: string | null): string {
  if (!iso) return "Time not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date);
}

export function ThreadsView({ caseId, focusContactId }: { caseId: string; focusContactId: string | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(focusContactId);
  const [tasks, setTasks] = useState<Record<string, ThreadTask["status"]>>({});
  const [taskNote, setTaskNote] = useState<string | null>(null);
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
        detail="Choose who to contact and save consent. Threads appear here after a message is drafted."
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
  const people: { id: string; label: string }[] =
    contacts.length > 0
      ? contacts.map((item) => ({ id: item.id, label: contactLabel(item) }))
      : threads.map((item) => ({ id: item.contactId, label: item.label }));
  const shownId = activeId ?? people[0]?.id ?? null;
  const contact = contacts.find((item) => item.id === shownId) ?? null;
  const thread = threads.find((item) => item.contactId === shownId) ?? null;

  async function approve(task: ThreadTask) {
    setTaskNote(null);
    const result = await approveTask(task.id);
    if (!result.available) {
      setTaskNote(result.reasons.join(" "));
      return;
    }
    if (!result.approved) {
      setTaskNote(result.reasons.join(" "));
      return;
    }
    setTasks((current) => ({ ...current, [task.id]: "approved" }));
    setTaskNote("The server approved this task. Nothing else is sent until the connection workflow runs.");
  }

  return (
    <div>
      {phase.kind === "unavailable" ? (
        <EmptyState
          title="Conversation history is not available yet"
          detail="The threads API is not connected. Contacts you already saved are listed below. Approving a task still goes through the task approval API when that route exists."
          actionHref={`/cases/${caseId}/outbox`}
          actionLabel="Review drafts"
        />
      ) : null}
      <ul className="thread-picker" aria-label="Contacts">
        {people.map((person) => (
          <li key={person.id}>
            <a
              href={`/cases/${caseId}/threads?contact=${encodeURIComponent(person.id)}`}
              aria-current={person.id === shownId ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                setActiveId(person.id);
                const url = new URL(window.location.href);
                url.searchParams.set("contact", person.id);
                window.history.replaceState(null, "", url);
              }}
            >
              {person.label}
            </a>
          </li>
        ))}
      </ul>
      <section aria-labelledby="thread-heading">
        <h2 id="thread-heading">{contact ? contactLabel(contact) : thread?.label ?? "Conversation"}</h2>
        {contact ? (
          <p className="thread-meta">
            {contact.channel === "email" ? "Email" : "Phone"} · {contact.address}
          </p>
        ) : null}
        {taskNote ? <p role="status">{taskNote}</p> : null}
        {!thread || thread.entries.length === 0 ? (
          <EmptyState
            title="No messages in this thread"
            detail="Outbound mail and call transcripts show up here after the connection workflow records them."
            actionHref={`/cases/${caseId}/outbox`}
            actionLabel="Open the outbox"
          />
        ) : (
          <ol className="thread-list">
            {thread.entries.map((entry) => (
              <li key={entry.id}>
                <ThreadItem entry={entry} taskStatus={entry.task ? tasks[entry.task.id] ?? entry.task.status : null} onApprove={approve} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function ThreadItem({
  entry,
  taskStatus,
  onApprove,
}: {
  entry: ThreadEntry;
  taskStatus: ThreadTask["status"] | null;
  onApprove: (task: ThreadTask) => void;
}) {
  const disclosure = disclosureFor(entry);
  const heading = entry.channel === "voice" ? (entry.direction === "outbound" ? "Call script" : "Call transcript") : entry.direction === "outbound" ? "Email sent" : "Reply";
  return (
    <article className="thread-entry" data-direction={entry.direction} data-channel={entry.channel} aria-label={heading}>
      <h3>{heading}</h3>
      {entry.subject ? <p>{entry.subject}</p> : null}
      <p className="thread-meta">{formatWhen(entry.at)}</p>
      <p>{entry.body}</p>
      {entry.direction === "outbound" ? (
        <>
          <p className="thread-fields">
            Shared fields: {entry.sharedFields.length > 0 ? entry.sharedFields.map(fieldLabel).join(", ") : "None listed"}
          </p>
          <p className="thread-fields">{disclosure ?? "The AI-assistance disclosure was not included in this message."}</p>
        </>
      ) : null}
      {entry.clinical ? (
        <p className="thread-clinical" role="note">
          {CLINICAL_NOTICE}
        </p>
      ) : null}
      {entry.classification ? (
        <p>
          Inbox classification: {entry.classification.label}. {entry.classification.rationale}
        </p>
      ) : null}
      {entry.task ? (
        <div>
          <p>
            Task: {TASK_KIND_LABELS[entry.task.kind]}. {entry.task.summary}
          </p>
          {taskStatus === "open" ? (
            <button type="button" onClick={() => onApprove(entry.task!)}>
              Approve task
            </button>
          ) : (
            <p role="status">Task status: {taskStatus}</p>
          )}
        </div>
      ) : null}
    </article>
  );
}
