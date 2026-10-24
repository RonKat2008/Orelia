"use client";

import { useState } from "react";
import { requestApproval } from "./approve";
import { CONTACT_STATES, STATE_LABELS, TASK_KIND_LABELS, type OutreachContact, type OutreachTask } from "./types";

function formatWhen(iso: string | null): string {
  if (!iso) return "None scheduled";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(iso));
}

export function TrackerBoard({
  contacts,
  tasks,
}: {
  contacts: OutreachContact[];
  tasks: OutreachTask[];
}) {
  const [openTasks, setOpenTasks] = useState(tasks);

  async function approveTask(task: OutreachTask) {
    const result = await requestApproval({ contactId: task.contactId, taskId: task.id });
    setOpenTasks((current) =>
      current.map((entry) => (entry.id === task.id ? { ...entry, status: "approved" } : entry)),
    );
    return result;
  }

  const needingApproval = openTasks.filter((task) => task.status === "open");

  return (
    <div>
      <section aria-labelledby="states-heading">
        <h2 id="states-heading">Contacts</h2>
        <ul className="plain">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <article data-contact-state={contact.state}>
                <h3>{contact.name}</h3>
                <p className="note">
                  {contact.role} · {contact.channel === "email" ? contact.address : contact.address}
                </p>
                <p>
                  State: <span className="status">{STATE_LABELS[contact.state]}</span>
                </p>
                <ol className="note" aria-label={`${contact.name} possible states`}>
                  {CONTACT_STATES.map((state) => (
                    <li key={state} aria-current={state === contact.state ? "step" : undefined}>
                      {STATE_LABELS[state]}
                    </li>
                  ))}
                </ol>
                <p>Next follow-up: {formatWhen(contact.nextFollowUpAt)}</p>
              </article>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading">Tasks needing approval</h2>
        {needingApproval.length === 0 ? <p>No open tasks.</p> : null}
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
                    <button type="button" onClick={() => approveTask(task)}>
                      Approve task
                    </button>
                  </div>
                ) : (
                  <p role="status">Approved. Nothing is sent until the connection workflow runs.</p>
                )}
              </article>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
