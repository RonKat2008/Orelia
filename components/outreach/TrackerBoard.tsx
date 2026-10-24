"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType } from "react";
import Link from "next/link";
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  Check,
  CircleCheck,
  CircleDot,
  Clock,
  Reply,
  Send,
  TriangleAlert,
} from "lucide-react";
import { Badge, Button, EmptyState as EmptyPanel, JudgeOnly, List, ListRow, TwoPane } from "@/components/ui";
import { EmptyState, LoadingSkeleton } from "@/components/threads/states";
import { ContactThreadView, type ThreadsStatus } from "@/components/threads/ThreadsView";
import type { ContactThread } from "@/components/threads/model";
import { getPlan } from "@/components/plan/client";
import { contactPlanLine } from "@/components/plan/model";
import type { ContactPlan } from "@/lib/plan/contract";
import { loadThreads } from "@/components/threads/load";
import { contactLabel, outreachSnapshot, readStoredOutreach, subscribeOutreach, type ApiContact } from "./client";
import { loadCaseContacts, loadCaseTasks } from "./case-activity";
import { formatDay, titleCase } from "./format";
import { TaskCard } from "./TaskCard";
import { loadApplications, type ApiApplication } from "./applications";
import { DemoCoordinatorBadge } from "./DemoCoordinators";
import { isDemoFormUrl } from "@/lib/outreach/demo-destinations-shared";
import { CONTACT_STATES, STATE_LABELS, type ContactState, type OutreachTask } from "./types";
import { cn } from "@/lib/ui/cn";
import { CASE_SECTION_HEADING, CASE_SUB_HEADING } from "./CasePage";

const SectionH = CASE_SECTION_HEADING;
const SubH = CASE_SUB_HEADING;

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

export const FOLLOW_UP_AWAITING_NOTE = "A follow-up is written and waiting for your approval in the outbox. Nothing has been sent.";

export function followUpNote(contact: ApiContact, state: ContactState, schedulingPaused: boolean): string {
  if (state === "sent" && contact.followUpAwaitingApproval) return FOLLOW_UP_AWAITING_NOTE;
  if (schedulingPaused && (state === "sent" || state === "replied")) {
    return `${SCHEDULING_PAUSED_NOTE} Nothing will go out on its own; you can still write and approve a follow-up yourself.`;
  }
  if (contact.nextFollowUpAt) return `Next follow-up ${formatDay(contact.nextFollowUpAt)}, if there is no reply. You approve it first.`;
  if (state === "drafted") return "No follow-up yet. The schedule starts when the first message is sent.";
  if (state === "sent" || state === "replied") return "Follow-ups are planned for business days 3 and 7 after sending. You approve each one.";
  return "No follow-up needed right now.";
}

/* ----------------------------- Row status word ----------------------------- */

type Tone = "teal" | "ok" | "warn" | "neutral";
interface StatusWord {
  word: string;
  tone: Tone;
  Icon: ComponentType<{ "aria-hidden"?: boolean }>;
}

/** One status word per contact (docs/DESIGN-v2.md 7.10): the 7-step journey lives in the detail pane. */
function statusWord(state: ContactState, needsYou: boolean): StatusWord {
  if (needsYou) return { word: "Needs you", tone: "teal", Icon: CircleDot };
  switch (state) {
    case "sent":
      return { word: "Sent", tone: "neutral", Icon: Send };
    case "replied":
    case "task_open":
    case "records_sent":
      return { word: "Replied", tone: "ok", Icon: Reply };
    case "appointment_booked":
      return { word: "Booked", tone: "ok", Icon: CalendarCheck };
    case "connected":
      return { word: "Connected", tone: "ok", Icon: CircleCheck };
    case "declined":
      return { word: "Declined", tone: "neutral", Icon: Ban };
    case "stalled":
      return { word: "No reply yet", tone: "warn", Icon: Clock };
    default:
      return { word: "Draft", tone: "neutral", Icon: CircleDot };
  }
}

function StatusBadge({ status }: { status: StatusWord }) {
  const { Icon } = status;
  return (
    <Badge tone={status.tone}>
      <Icon aria-hidden /> {status.word}
    </Badge>
  );
}

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "America/New_York" });

/** "Mon 27 Oct" (fixed zone so server and client agree), or null for a missing or bad date. */
function shortDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : SHORT_DAY.format(date).replace(",", "");
}

interface ContactView {
  contact: ApiContact;
  state: ContactState;
  name: string;
  tasks: OutreachTask[];
  openTasks: OutreachTask[];
  awaitingFollowUp: boolean;
  needsYou: boolean;
}

function rowNext(view: ContactView, schedulingPaused: boolean): string | null {
  const { contact, state } = view;
  if (state === "drafted") return "Draft waiting for your OK";
  if (view.openTasks.length > 0) return "They asked for something";
  if (view.awaitingFollowUp) return "Follow-up waiting for your OK";
  if (schedulingPaused && (state === "sent" || state === "replied")) return "Follow-ups paused";
  const day = shortDay(contact.nextFollowUpAt);
  return day ? `We'll follow up on ${day}` : null;
}

/** Contacts known only from the thread list (no stored or live contact rows): enough to show the conversation. */
function contactsFromThreads(caseId: string, threads: readonly ContactThread[]): ApiContact[] {
  return threads.map((thread) => ({
    id: thread.contactId,
    caseId,
    targetId: thread.contactId,
    targetKind: "contact",
    channel: thread.entries[0]?.channel ?? "email",
    address: "",
    state: thread.entries.some((entry) => entry.direction === "inbound") ? "replied" : "sent",
    displayName: thread.label,
  }));
}

/** Keep ?contact= in the address bar (deep link) without a navigation; other params (e.g. ?view=) stay. */
function rememberContact(id: string) {
  try {
    const params = new URLSearchParams(window.location.search);
    params.set("contact", id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  } catch {
    // Address-bar sync is a convenience; selection already happened.
  }
}

interface TrackerBoardProps {
  caseId: string;
  tasks: OutreachTask[];
  /** True when no scheduler (Inngest or Vercel Cron) is connected: day-3/day-7 follow-ups are not scheduled. */
  schedulingPaused?: boolean;
  /** Contact to open (the /threads?contact= and /tracker?contact= deep link). */
  focusContactId?: string | null;
}

export function TrackerBoard({ caseId, tasks, schedulingPaused = false, focusContactId = null }: TrackerBoardProps) {
  const raw = useSyncExternalStore(subscribeOutreach, () => outreachSnapshot(caseId), () => null);
  const stored: ApiContact[] = raw ? (readStoredOutreach(caseId)?.contacts ?? []) : [];
  const [liveContacts, setLiveContacts] = useState<ApiContact[] | null>(null);
  const [contactsSettled, setContactsSettled] = useState(false);
  const [liveTasks, setLiveTasks] = useState<OutreachTask[]>([]);
  const [done, setDone] = useState<Record<string, OutreachTask["status"]>>({});

  const [plan, setPlan] = useState<ContactPlan | null>(null);
  const [threads, setThreads] = useState<ContactThread[]>([]);
  const [threadsStatus, setThreadsStatus] = useState<ThreadsStatus>("loading");
  const [threadsAttempt, setThreadsAttempt] = useState(0);
  const [applications, setApplications] = useState<ApiApplication[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(focusContactId);
  const [detailOpen, setDetailOpen] = useState(Boolean(focusContactId));
  const [prevFocus, setPrevFocus] = useState(focusContactId);
  if (focusContactId !== prevFocus) {
    setPrevFocus(focusContactId);
    setSelectedId(focusContactId);
    setDetailOpen(Boolean(focusContactId));
  }

  // Online applications (web_form channel) are tracked next to the email and call journeys.
  useEffect(() => {
    let active = true;
    void loadApplications(caseId).then((rows) => {
      if (active) setApplications(rows);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  useEffect(() => {
    let active = true;
    void loadCaseContacts(caseId).then((rows) => {
      if (!active) return;
      setContactsSettled(true);
      if (!rows) return;
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

  const realContacts = liveContacts ?? stored;
  const contactIds = realContacts.map((contact) => contact.id).join("|");

  // Conversations (and the tasks inside them). If that API is not connected yet, the thread part says so.
  useEffect(() => {
    let active = true;
    void loadThreads(caseId).then((result) => {
      if (!active) return;
      if (result.status === "unavailable") return setThreadsStatus("unavailable");
      if (result.status !== "ok" || !result.threads) return setThreadsStatus("error");
      setThreads(result.threads);
      setThreadsStatus("ok");
    });
    return () => {
      active = false;
    };
  }, [caseId, threadsAttempt]);

  useEffect(() => {
    let active = true;
    const names = new Map(realContacts.map((contact) => [contact.id, contactLabel(contact)]));
    void loadCaseTasks(caseId, names).then((rows) => {
      if (!active || !rows) return;
      setLiveTasks(rows);
    });
    return () => {
      active = false;
    };
  }, [caseId, contactIds, realContacts]);

  const threadTasks = threads.flatMap((thread) =>
    thread.entries.flatMap((entry) =>
      entry.task ? [{ ...entry.task, contactId: thread.contactId, contactName: thread.label, dueAt: null } satisfies OutreachTask] : [],
    ),
  );
  const allTasks = [...tasks, ...liveTasks, ...threadTasks].filter(
    (task, index, all) => all.findIndex((known) => known.id === task.id) === index,
  );
  const statusOf = (task: OutreachTask) => done[task.id] ?? task.status;

  const contacts = realContacts.length > 0 ? realContacts : contactsFromThreads(caseId, threads);

  if (contacts.length === 0) {
    if (!contactsSettled || threadsStatus === "loading") return <LoadingSkeleton label="Loading your contacts" />;
    return (
      <EmptyState
        title="No one has been contacted yet"
        detail="Choose who to contact from your shortlist and decide what each may see. They will show up here."
        actionHref={`/cases/${caseId}/shortlist`}
        actionLabel="Choose who to contact"
      />
    );
  }

  const views: ContactView[] = contacts.map((contact) => {
    const state = asState(contact.state);
    const contactTasks = allTasks.filter((task) => task.contactId === contact.id);
    const openTasks = contactTasks.filter((task) => statusOf(task) === "open");
    const awaitingFollowUp = state === "sent" && Boolean(contact.followUpAwaitingApproval);
    return {
      contact,
      state,
      name: titleCase(contactLabel(contact)),
      tasks: contactTasks,
      openTasks,
      awaitingFollowUp,
      needsYou: state === "drafted" || openTasks.length > 0 || awaitingFollowUp,
    };
  });
  // What needs you comes first; otherwise the order the contacts were made in.
  const ordered = [...views.filter((view) => view.needsYou), ...views.filter((view) => !view.needsYou)];
  const knownIds = new Set(contacts.map((contact) => contact.id));
  const orphanTasks = allTasks.filter((task) => !knownIds.has(task.contactId) && statusOf(task) === "open");

  // One primary for the whole view: the first "Needs you" item, if any.
  const primaryContactId = ordered.find((view) => view.needsYou)?.contact.id ?? null;
  const primaryOrphanId = primaryContactId ? null : (orphanTasks[0]?.id ?? null);

  const shownId = selectedId && knownIds.has(selectedId) ? selectedId : (primaryContactId ?? ordered[0]?.contact.id ?? null);
  const shown = ordered.find((view) => view.contact.id === shownId) ?? null;

  const select = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    rememberContact(id);
  };
  const setTaskStatus = (id: string, next: OutreachTask["status"]) => setDone((current) => ({ ...current, [id]: next }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      {schedulingPaused ? (
        <p role="status" className="m-0 flex items-start gap-2 rounded-md bg-paper-2 p-4 text-small text-ink-2">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {SCHEDULING_PAUSED_NOTE}
        </p>
      ) : null}

      {orphanTasks.length > 0 ? (
        <section aria-labelledby="other-requests-heading" className="grid gap-4">
          <SectionH id="other-requests-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
            Other requests
          </SectionH>
          <ul className="m-0 grid list-none gap-6 p-0">
            {orphanTasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  status={statusOf(task)}
                  onStatus={(next) => setTaskStatus(task.id, next)}
                  emphasis={task.id === primaryOrphanId ? "primary" : "link"}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TwoPane
        listLabel="Contacts"
        detailLabel="Selected contact"
        list={
          <List label="Who we've contacted">
            {ordered.map((view) => {
              const next = rowNext(view, schedulingPaused);
              const channel = view.contact.channel === "email" ? "Email" : "Phone";
              return (
                <ListRow
                  key={view.contact.id}
                  data-contact-state={view.state}
                  title={view.name}
                  meta={next ? `${channel} · ${next}` : channel}
                  badges={[
                    <StatusBadge key="status" status={statusWord(view.state, view.needsYou)} />,
                    <DemoCoordinatorBadge key="demo" address={view.contact.address} />,
                  ]}
                  onSelect={() => select(view.contact.id)}
                  selected={view.contact.id === shownId}
                />
              );
            })}
          </List>
        }
        detail={
          shown ? (
            <ContactDetail
              caseId={caseId}
              view={shown}
              plan={plan}
              schedulingPaused={schedulingPaused}
              isPrimary={shown.contact.id === primaryContactId}
              statusOf={statusOf}
              onTaskStatus={setTaskStatus}
              threadsStatus={threadsStatus}
              thread={threads.find((thread) => thread.contactId === shown.contact.id) ?? null}
              onRetryThreads={() => {
                setThreadsStatus("loading");
                setThreadsAttempt((value) => value + 1);
              }}
            />
          ) : null
        }
        emptyDetail={<EmptyPanel title="Pick a contact" description="Their messages, requests and follow-ups show here." titleAs={CASE_SECTION_HEADING} />}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        detailTitle={shown?.name}
      />

      {applications.length > 0 ? (
        <ApplicationsSection applications={applications} contacts={contacts} />
      ) : null}
    </div>
  );
}

/* ------------------------------- Detail pane ------------------------------- */

const SECTION_HEADING = "m-0 text-body font-semibold text-ink";

function ContactDetail({
  caseId,
  view,
  plan,
  schedulingPaused,
  isPrimary,
  statusOf,
  onTaskStatus,
  threadsStatus,
  thread,
  onRetryThreads,
}: {
  caseId: string;
  view: ContactView;
  plan: ContactPlan | null;
  schedulingPaused: boolean;
  isPrimary: boolean;
  statusOf: (task: OutreachTask) => OutreachTask["status"];
  onTaskStatus: (id: string, next: OutreachTask["status"]) => void;
  threadsStatus: ThreadsStatus;
  thread: ContactThread | null;
  onRetryThreads: () => void;
}) {
  const { contact, state, name } = view;
  const id = contact.id;
  const planLine = contactPlanLine(plan, { contactId: id, state, nextAt: contact.nextFollowUpAt });
  // The first pending item gets the view's one primary; any others are links.
  const primaryTaskId = isPrimary && state !== "drafted" ? (view.openTasks[0]?.id ?? null) : null;
  const followUpPrimary = isPrimary && state !== "drafted" && view.openTasks.length === 0;
  const tasks = [...view.openTasks, ...view.tasks.filter((task) => statusOf(task) !== "open")];
  const hasRequests = state === "drafted" || view.awaitingFollowUp || tasks.length > 0;

  return (
    <article data-contact-state={state} aria-labelledby={`contact-${id}`} className="grid min-w-0 gap-8">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <SectionH id={`contact-${id}`} className="m-0 min-w-0 break-words font-display text-h3 font-normal text-ink display-soft">
            {name}
          </SectionH>
          <StatusBadge status={statusWord(state, view.needsYou)} />
        </div>
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 break-words text-small text-ink-2">
          <span className="min-w-0 break-all">
            {contact.channel === "email" ? "Email" : "Phone"}
            {contact.address ? ` · ${contact.address}` : null}
          </span>
          <DemoCoordinatorBadge address={contact.address} />
        </p>
      </header>

      {hasRequests ? (
        <section aria-labelledby={`needs-${id}`} className="grid gap-4">
          <SubH id={`needs-${id}`} className={SECTION_HEADING}>
            {view.needsYou ? "Needs you" : "Requests"}
          </SubH>
          {state === "drafted" ? (
            <PendingAction
              text={`Approve the draft for ${name}. Nothing has been sent to them yet.`}
              href={`/cases/${caseId}/outbox`}
              label="Read the draft"
              primary={isPrimary}
            />
          ) : null}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              status={statusOf(task)}
              onStatus={(next) => onTaskStatus(task.id, next)}
              emphasis={task.id === primaryTaskId ? "primary" : "link"}
            />
          ))}
          {view.awaitingFollowUp ? (
            <PendingAction
              text={FOLLOW_UP_AWAITING_NOTE}
              href={`/cases/${caseId}/outbox`}
              label="Review the follow-up"
              primary={followUpPrimary}
            />
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby={`stands-${id}`} className="grid gap-4">
        <SubH id={`stands-${id}`} className={SECTION_HEADING}>
          Where it stands
        </SubH>
        <p className="m-0 max-w-prose text-body text-ink-2">{STATE_NOTES[state]}</p>
        <JourneyTimeline state={state} name={name} />
      </section>

      <section aria-labelledby={`thread-${id}`} className="grid gap-4">
        <SubH id={`thread-${id}`} className={SECTION_HEADING}>
          Conversation
        </SubH>
        <ContactThreadView caseId={caseId} status={threadsStatus} thread={thread} onRetry={onRetryThreads} />
      </section>

      <section aria-labelledby={`follow-${id}`} className="grid gap-2">
        <SubH id={`follow-${id}`} className={SECTION_HEADING}>
          Follow-ups
        </SubH>
        <p className="m-0 flex items-start gap-2 text-small text-ink-2">
          <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{followUpNote(contact, state, schedulingPaused)}</span>
        </p>
        {planLine ? (
          <JudgeOnly>
            <p className="m-0 grid gap-1 text-small text-ink-2" data-plan-line>
              <span className="font-semibold text-ink">{planLine.current}</span>
              <span>{planLine.next}</span>
            </p>
          </JudgeOnly>
        ) : null}
      </section>
    </article>
  );
}

function PendingAction({ text, href, label, primary }: { text: string; href: string; label: string; primary: boolean }) {
  return (
    <div className="grid justify-items-start gap-2 border-l-2 border-l-teal pl-4">
      <p className="m-0 max-w-prose break-words text-body text-ink">{text}</p>
      {primary ? (
        <Button asChild>
          <Link href={href}>{label}</Link>
        </Button>
      ) : (
        <Button asChild variant="link">
          <Link href={href}>{label}</Link>
        </Button>
      )}
    </div>
  );
}

/** The journey as a quiet vertical list: done steps in ink-2 with a check, the current one in teal, the rest faint. */
function JourneyTimeline({ state, name }: { state: ContactState; name: string }) {
  const index = JOURNEY.indexOf(state);
  if (index === -1) return null;
  return (
    <ol aria-label={`${name}: journey`} className="m-0 grid list-none gap-2 p-0">
      {JOURNEY.map((step, stepIndex) => {
        const stepState = stepIndex < index ? "done" : stepIndex === index ? "current" : "upcoming";
        return (
          <li
            key={step}
            aria-current={stepState === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 text-small",
              stepState === "done" && "text-ink-2",
              stepState === "current" && "font-semibold text-teal-ink dark:text-teal",
              stepState === "upcoming" && "text-ink-3",
            )}
          >
            {stepState === "done" ? (
              <Check aria-hidden className="size-4 shrink-0" />
            ) : (
              <span aria-hidden className="grid size-4 shrink-0 place-items-center">
                <span className={cn("size-2 rounded-pill", stepState === "current" ? "bg-teal" : "border border-line-strong")} />
              </span>
            )}
            {STATE_LABELS[step]}
            <span className="sr-only">{stepState === "done" ? " (done)" : stepState === "current" ? " (now)" : " (not yet)"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------- Online applications --------------------------- */

const APPLICATION_STATUS: Record<string, string> = {
  draft: "Needs your review",
  approved: "Approved",
  submitting: "Submitting",
  submitted: "Submitted",
  stale: "Form changed",
  refused: "Refused",
  failed: "Not submitted",
};

function applicationBadge(status: string): StatusWord {
  const word = APPLICATION_STATUS[status] ?? status;
  if (status === "submitted") return { word, tone: "ok", Icon: CircleCheck };
  if (status === "draft") return { word, tone: "teal", Icon: CircleDot };
  if (status === "stale" || status === "refused" || status === "failed") return { word, tone: "warn", Icon: TriangleAlert };
  return { word, tone: "neutral", Icon: Clock };
}

function applicationNote(application: ApiApplication): string {
  const where = isDemoFormUrl(application.url) ? "the Wayfinder demo intake form" : "their online form";
  if (application.status === "submitted") {
    return `Submitted to ${where}${application.submittedAt ? ` on ${formatDay(application.submittedAt)}` : ""}.`;
  }
  if (application.status === "draft") return `Filled in on ${where} and waiting for your review. Nothing was submitted.`;
  return `Application to ${where}.`;
}

function ApplicationsSection({ applications, contacts }: { applications: ApiApplication[]; contacts: ApiContact[] }) {
  return (
    <section aria-labelledby="applications-heading" className="grid gap-4" data-testid="tracker-applications">
      <SectionH id="applications-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        Online applications
      </SectionH>
      <List>
        {applications.map((application) => {
          const owner = contacts.find((contact) => contact.id === application.contactId);
          return (
            <ListRow
              key={application.id}
              data-application-status={application.status}
              title={owner ? titleCase(contactLabel(owner)) : "Online form"}
              meta={applicationNote(application)}
              badges={[
                <StatusBadge key="status" status={applicationBadge(application.status)} />,
                <DemoCoordinatorBadge key="demo" address={application.url} />,
              ]}
            />
          );
        })}
      </List>
    </section>
  );
}
