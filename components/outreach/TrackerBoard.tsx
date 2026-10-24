"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Mail, MessageSquareText, PhoneCall } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  AvatarInitials,
  Badge,
  Button,
  Card,
  CardEyebrow,
  CardTitle,
  Stepper,
} from "@/components/ui";
import { EmptyState } from "@/components/threads/states";
import { getPlan } from "@/components/plan/client";
import { contactPlanLine } from "@/components/plan/model";
import type { ContactPlan } from "@/lib/plan/contract";
import { loadThreads } from "@/components/threads/load";
import { contactLabel, outreachSnapshot, readStoredOutreach, subscribeOutreach, type ApiContact } from "./client";
import { loadCaseContacts, loadCaseTasks } from "./case-activity";
import { formatDay, titleCase } from "./format";
import { TaskCard } from "./TaskCard";
import { CONTACT_STATES, STATE_LABELS, type ContactState, type OutreachTask } from "./types";
import { cn } from "@/lib/ui/cn";

/** The happy path. Declined and stalled are exits from it, not steps on it. */
const JOURNEY: readonly ContactState[] = [
  "drafted",
  "sent",
  "replied",
  "task_open",
  "records_sent",
  "appointment_booked",
  "connected",
];

const STATE_NOTES: Record<ContactState, string> = {
  drafted: "A draft is written and waiting for your approval. Nothing has been sent.",
  sent: "Your approved message went out. We are waiting for a reply.",
  replied: "They answered. Read the reply, then decide what comes next.",
  task_open: "They asked for something. It is waiting for your approval.",
  records_sent: "What they asked for was sent, with your approval.",
  appointment_booked: "An appointment is on the calendar.",
  connected: "You are connected. This one is done.",
  declined: "They said no. We will not contact them again.",
  stalled: "No reply after our follow-ups, so we stopped. You can choose to try again.",
};

function asState(value: string): ContactState {
  return (CONTACT_STATES as readonly string[]).includes(value) ? (value as ContactState) : "drafted";
}

export const SCHEDULING_PAUSED_NOTE = "Automatic follow-ups are paused until scheduling is connected.";

function followUpNote(contact: ApiContact, state: ContactState, schedulingPaused: boolean): string {
  if (schedulingPaused && (state === "sent" || state === "replied")) {
    return `${SCHEDULING_PAUSED_NOTE} Nothing will go out on its own; you can still write and approve a follow-up yourself.`;
  }
  if (contact.nextFollowUpAt) return `Next follow-up ${formatDay(contact.nextFollowUpAt)}, if there is no reply. You approve it first.`;
  if (state === "drafted") return "No follow-up yet. The schedule starts when the first message is sent.";
  if (state === "sent" || state === "replied") return "Follow-ups are planned for business days 3 and 7 after sending. You approve each one.";
  return "No follow-up needed right now.";
}

interface TrackerBoardProps {
  caseId: string;
  tasks: OutreachTask[];
  /** True when no scheduler (Inngest or Vercel Cron) is connected: day-3/day-7 follow-ups are not scheduled. */
  schedulingPaused?: boolean;
}

export function TrackerBoard({ caseId, tasks, schedulingPaused = false }: TrackerBoardProps) {
  const raw = useSyncExternalStore(subscribeOutreach, () => outreachSnapshot(caseId), () => null);
  const stored: ApiContact[] = raw ? (readStoredOutreach(caseId)?.contacts ?? []) : [];
  const [liveContacts, setLiveContacts] = useState<ApiContact[] | null>(null);
  const [liveTasks, setLiveTasks] = useState<OutreachTask[]>([]);
  const [done, setDone] = useState<Record<string, OutreachTask["status"]>>({});

  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [threadTasks, setThreadTasks] = useState<OutreachTask[]>([]);

  useEffect(() => {
    let active = true;
    void loadCaseContacts(caseId).then((rows) => {
      if (!active || !rows) return;
      setLiveContacts(rows);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  // The contact plan is optional: on a 404 or any failure the tracker just shows no plan line.
  useEffect(() => {
    let active = true;
    void getPlan(caseId).then((res) => {
      if (active) setPlan(res.ok ? res.plan : null);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const contacts = liveContacts ?? stored;
  const contactIds = contacts.map((contact) => contact.id).join("|");

  // Tasks live inside conversation threads. If that API is not connected yet, the list simply stays empty.
  useEffect(() => {
    let active = true;
    void loadThreads(caseId).then((result) => {
      if (!active || result.status !== "ok" || !result.threads) return;
      setThreadTasks(
        result.threads.flatMap((thread) =>
          thread.entries.flatMap((entry) =>
            entry.task
              ? [{ ...entry.task, contactId: thread.contactId, contactName: thread.label, dueAt: null } satisfies OutreachTask]
              : [],
          ),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  useEffect(() => {
    let active = true;
    const names = new Map(contacts.map((contact) => [contact.id, contactLabel(contact)]));
    void loadCaseTasks(caseId, names).then((rows) => {
      if (!active || !rows) return;
      setLiveTasks(rows);
    });
    return () => {
      active = false;
    };
  }, [caseId, contactIds, contacts]);

  const allTasks = [...tasks, ...liveTasks, ...threadTasks].filter(
    (task, index, all) => all.findIndex((known) => known.id === task.id) === index,
  );
  const openTasks = allTasks.filter((task) => (done[task.id] ?? task.status) === "open");
  const waitingDrafts = contacts.filter((contact) => asState(contact.state) === "drafted");
  const nothingNow = openTasks.length === 0 && waitingDrafts.length === 0;

  if (contacts.length === 0) {
    return (
      <EmptyState
        title="No one has been contacted yet"
        detail="Choose resources from your shortlist and decide what each may see. Their journeys will show up here."
        actionHref={`/cases/${caseId}/shortlist`}
        actionLabel="Choose resources"
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-16">
      {schedulingPaused ? (
        <p
          role="status"
          className="m-0 flex items-start gap-2 rounded-md border border-gold/60 bg-gold-soft p-4 text-small text-ink"
        >
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {SCHEDULING_PAUSED_NOTE}
        </p>
      ) : null}
      <section aria-labelledby="now-heading" className="grid gap-6">
        <div className="grid gap-2">
          <h3 id="now-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
            Needs you <em className="emph">now</em>
          </h3>
          <p className="m-0 max-w-prose text-body text-ink-2">
            {nothingNow
              ? "Nothing is waiting on you. We will tell you here when a contact asks for something."
              : "These are the only things holding your outreach up."}
          </p>
        </div>
        {!nothingNow ? (
          <ul className="m-0 grid list-none gap-3 p-0">
            {waitingDrafts.map((contact) => (
              <li key={contact.id}>
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-line bg-card p-4 shadow-xs sm:p-5">
                  <div className="grid min-w-0 gap-1">
                    <Badge tone="gold" dot>
                      Needs you
                    </Badge>
                    <span className="break-words font-semibold text-ink">Approve the draft for {contactLabel(contact)}</span>
                    <span className="text-small text-ink-2">Nothing has been sent to them yet.</span>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/cases/${caseId}/outbox`}>
                      Read the draft <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
            {openTasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  status={done[task.id] ?? task.status}
                  onStatus={(next) => setDone((current) => ({ ...current, [task.id]: next }))}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="journeys-heading" className="grid gap-6">
        <h3 id="journeys-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
          Each <em className="emph">journey</em>
        </h3>
        <ul className="m-0 grid list-none gap-6 p-0">
          {contacts.map((contact) => {
            const state = asState(contact.state);
            const name = titleCase(contactLabel(contact));
            const index = JOURNEY.indexOf(state);
            const offPath = index === -1;
            const planLine = contactPlanLine(plan, { contactId: contact.id, state, nextAt: contact.nextFollowUpAt });
            const ChannelIcon = contact.channel === "email" ? Mail : PhoneCall;
            return (
              <li key={contact.id}>
                <Card variant="raised" data-contact-state={state} aria-labelledby={`journey-${contact.id}`}>
                  <div className="flex flex-wrap items-center gap-4">
                    <AvatarInitials name={name.replace(/[()]/g, "")} size="md" />
                    <div className="grid min-w-0 flex-1 gap-1">
                      <CardEyebrow className="flex items-center gap-1.5">
                        <ChannelIcon aria-hidden className={cn("size-3.5", contact.channel === "email" ? "text-ch-email" : "text-ch-call")} /> {contact.channel === "email" ? "Email" : "Phone"}
                      </CardEyebrow>
                      <CardTitle id={`journey-${contact.id}`} className="break-words text-h4">
                        {name}
                      </CardTitle>
                    </div>
                    <Badge
                      tone={state === "connected" ? "ok" : state === "declined" ? "danger" : state === "stalled" ? "warn" : "teal"}
                      size="md"
                    >
                      {STATE_LABELS[state]}
                    </Badge>
                  </div>

                  {!offPath ? (
                    <div
                      aria-hidden
                      className="mt-6 grid gap-1"
                      style={{ gridTemplateColumns: `repeat(${JOURNEY.length}, minmax(0, 1fr))` }}
                    >
                      {JOURNEY.map((step, stepIndex) => (
                        <span
                          key={step}
                          className={
                            stepIndex < index
                              ? "h-1.5 rounded-pill bg-teal"
                              : stepIndex === index
                                ? "h-1.5 rounded-pill bg-teal ring-2 ring-teal/25"
                                : "h-1.5 rounded-pill bg-paper-2 shadow-inset"
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                  <p className="m-0 mt-4 max-w-prose text-body text-ink">{STATE_NOTES[state]}</p>
                  <p className="m-0 mt-2 flex items-start gap-2 text-small text-ink-2">
                    <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {followUpNote(contact, state, schedulingPaused)}
                  </p>

                  {planLine ? (
                    <p className="m-0 mt-2 grid gap-0.5 text-small text-ink-2" data-plan-line>
                      <span className="font-semibold text-ink">{planLine.current}</span>
                      <span>{planLine.next}</span>
                    </p>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/cases/${caseId}/threads?contact=${encodeURIComponent(contact.id)}`}>
                        <MessageSquareText aria-hidden /> Open conversation
                      </Link>
                    </Button>
                  </div>

                  {!offPath ? (
                    <Accordion type="single" collapsible className="mt-4">
                      <AccordionItem value="journey">
                        <AccordionTrigger>The full journey</AccordionTrigger>
                        <AccordionContent>
                          <Stepper
                            orientation="vertical"
                            current={index}
                            aria-label={`${name} journey`}
                            steps={JOURNEY.map((step) => ({ id: step, label: STATE_LABELS[step] }))}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
