"use client";

import { useState, useSyncExternalStore } from "react";
import { approveTask, contactLabel, outreachSnapshot, readStoredOutreach, subscribeOutreach, type ApiContact } from "./client";
import { CONTACT_STATES, STATE_LABELS, TASK_KIND_LABELS, type ContactState, type OutreachTask } from "./types";

function formatWhen(iso: string | null): string {
  if (!iso) return "None scheduled";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(iso));
}

function asState(value: string): ContactState {
  return (CONTACT_STATES as readonly string[]).includes(value) ? (value as ContactState) : "drafted";
}

export function TrackerBoard({ caseId, tasks }: { caseId: string; tasks: OutreachTask[] }) {
  const raw = useSyncExternalStore(subscribeOutreach, () => outreachSnapshot(caseId), () => null);
  const contacts: ApiContact[] = raw ? (readStoredOutreach(caseId)?.contacts ?? []) : [];
  const [openTasks, setOpenTasks] = useState(tasks);
  const [taskNote, setTaskNote] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<string[]>([]);

  async function approve(task: OutreachTask) {
    setTaskErrors([]);
    const result = await approveTask(task.id);
    if (!result.available) {
      setTaskNote(result.reasons.join(" "));
      return;
    }
    if (!result.approved) {
      setTaskErrors(result.reasons);
      setTaskNote("The server did not approve this task.");
      return;
    }
    setOpenTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, status: "approved" } : entry)));
    setTaskNote("The server approved this task. Nothing is sent until the connection workflow runs.");
  }

  return (
    <div>
      <section aria-labelledby="states-heading">
        <h2 id="states-heading">Contacts</h2>
        {contacts.length === 0 ? (
          <p>
            No contacts yet. <a href={`/cases/${caseId}/shortlist`}>Choose resources</a>, then save consent.
          </p>
        ) : null}
        <ul className="plain">
          {contacts.map((contact) => {
            const state = asState(contact.state);
            return (
              <li key={contact.id}>
                <article data-contact-state={state}>
                  <h3>{contactLabel(contact)}</h3>
                  <p className="note">
                    {contact.channel === "email" ? "Email" : "Phone"} · {contact.address}
                  </p>
                  <p>
                    State: <span className="status">{STATE_LABELS[state]}</span>
                  </p>
                  <ol className="note" aria-label={`${contactLabel(contact)} possible states`}>
                    {CONTACT_STATES.map((step) => (
                      <li key={step} aria-current={step === state ? "step" : undefined}>
                        {STATE_LABELS[step]}
                      </li>
                    ))}
                  </ol>
                  <p>Next follow-up: {formatWhen(null)}</p>
                  <p>
                    <a href={`/cases/${caseId}/threads?contact=${encodeURIComponent(contact.id)}`}>Open conversation</a>
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">Tasks needing approval</h2>
        {taskNote ? <p role="status">{taskNote}</p> : null}
        {taskErrors.length > 0 ? (
          <ul>
            {taskErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        {openTasks.filter((task) => task.status === "open").length === 0 ? (
          <p>No open tasks are loaded. When the inbox agent creates one, approving it uses the task approval API and stays open until that API confirms.</p>
        ) : null}
        <ul className="plain">
          {openTasks.map((task) => (
            <li key={task.id}>
              <article data-task-status={task.status}>
                <h3>{TASK_KIND_LABELS[task.kind]}</h3>
                <p>{task.summary}</p>
                <p className="note">
                  {task.contactName} · due {formatWhen(task.dueAt)} · {task.status}
                </p>
                {task.status === "open" ? (
                  <div className="actions">
                    <button type="button" onClick={() => void approve(task)}>
                      Approve task
                    </button>
                  </div>
                ) : (
                  <p role="status">Approved by the server. Nothing is sent until the connection workflow runs.</p>
                )}
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
