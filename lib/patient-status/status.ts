import type {
  PatientCaseSnapshot,
  PatientContact,
  PatientNextAction,
  PatientRun,
  PatientStatus,
  PatientTask,
} from "./types";

/**
 * The patient view's one-line live status. Deterministic: rules over the case's own rows, no model, so it cannot
 * invent anything. It never interprets the case or suggests care; people and programs are named, nothing else.
 */

const INTAKE = new Set(["draft", "extracted", "unconfirmed"]);
const SEARCHING = new Set(["confirmed", "researching"]);
const TERMINAL_RUN = new Set(["done", "failed", "not_implemented"]);
const MAX_PICKS = 5;

/** Plain names for what each research agent reads. Names only: no claims about what was found. */
export const SOURCE_NAMES: Record<string, string> = {
  literature: "published medical papers on PubMed",
  trials: "ClinicalTrials.gov",
  identity: "the national provider registry",
  centers: "lists of specialist centers",
  advocacy: "patient advocacy groups",
  aid: "financial and travel help programs",
  contact_finder: "public contact pages",
  network: "referral networks",
  logistics: "travel and distance details",
};

/** Rows the pipeline writes after the nine sources (lib/agents/phase-runs), worded while they run. */
const PHASE_WORDS: Record<string, string> = {
  verifier: "Checking every name against its public source…",
  ranker: "Sorting the best matches for you…",
  curator: "Picking a few to suggest…",
};

/** Only the research agents' rows are "sources"; phase and heartbeat rows are not counted. */
export function sourceRuns(runs: readonly PatientRun[]): PatientRun[] {
  return runs.filter((run) => run.agent in SOURCE_NAMES);
}

const GOOD_NEWS_ORDER = ["appointment_booked", "connected", "records_sent", "replied", "task_open"];

export interface PatientStatusOptions {
  now: Date;
  /** IANA time zone used to name follow-up days. Invalid values fall back to UTC. */
  timeZone?: string;
}

type Ctx = { s: PatientCaseSnapshot; now: Date; timeZone: string; updatedAt: string };

export function patientStatus(snapshot: PatientCaseSnapshot, options: PatientStatusOptions): PatientStatus {
  const ctx: Ctx = {
    s: snapshot,
    now: options.now,
    timeZone: validTimeZone(options.timeZone),
    updatedAt: latestActivity(snapshot) ?? options.now.toISOString(),
  };
  return pick(ctx);
}

/** Changes exactly when what the patient sees changes; used to decide whether to push an update. */
export function statusKey(status: PatientStatus): string {
  const a = status.nextAction;
  return JSON.stringify([
    status.headline,
    status.detail ?? null,
    status.step,
    status.tone,
    a ? [a.kind, a.contactId ?? null, a.taskId ?? null, a.applicationId ?? null, a.draftId ?? null] : null,
    status.progress ?? null,
  ]);
}

function pick(ctx: Ctx): PatientStatus {
  const { s } = ctx;
  const make = (rest: Omit<PatientStatus, "updatedAt">): PatientStatus => ({ ...rest, updatedAt: ctx.updatedAt });

  if (!s.found) {
    return make({
      headline: "We couldn't find this case.",
      detail: "It may have been removed, or the link may be incomplete.",
      step: "tell",
      tone: "problem",
    });
  }

  const status = s.caseStatus ?? "";
  if (!status || INTAKE.has(status)) {
    return make({
      headline: "Check your details so we can start looking.",
      detail: "Nothing is sent to anyone until you say so.",
      step: "tell",
      tone: "you",
      nextAction: { kind: "confirm_details", label: "Check my details", detailsHref: "/start?view=judge" },
    });
  }

  if (SEARCHING.has(status)) return make(searching(ctx));

  const found = s.shortlist?.total ?? null;
  if (status === "research_failed" && !found) {
    return make({
      headline: "Our search ran into a problem before it finished.",
      detail: "Nothing was sent to anyone. You can try the search again.",
      step: "search",
      tone: "problem",
      nextAction: { kind: "retry_search", label: "Try the search again", detailsHref: details(s, "swarm") },
    });
  }

  if (s.contacts.length === 0) return make(choosing(ctx, found, status === "research_failed"));

  const unshared = s.contacts.filter((c) => !c.consented);
  if (unshared.length > 0) {
    return make({
      headline: `Choose what we may share with ${unshared.length === 1 ? unshared[0]!.name : `the ${unshared.length} people you picked`}.`,
      detail: "Only what you tick is ever shared. You can change it later.",
      step: "choose",
      tone: "you",
      nextAction: { kind: "share_details", label: "Choose what to share", detailsHref: details(s, "consent") },
    });
  }

  return make(reaching(ctx));
}

function searching(ctx: Ctx): Omit<PatientStatus, "updatedAt"> {
  const { s } = ctx;
  const sources = sourceRuns(s.runs);
  const total = Math.max(s.expectedSources, sources.length);
  const done = sources.filter((run) => TERMINAL_RUN.has(run.status)).length;
  const who = s.diseaseName?.trim() ? s.diseaseName.trim() : "your condition";
  if (sources.length > 0 && done >= total) {
    const phase = s.runs.find((run) => run.status === "running" && PHASE_WORDS[run.agent]);
    return {
      headline: phase ? PHASE_WORDS[phase.agent]! : "Done looking. Putting your list together…",
      detail: "We check every name against its public source before showing it to you.",
      step: "search",
      tone: "working",
      progress: { done, total },
    };
  }
  const running = sources.find((run) => run.status === "running");
  return {
    headline: `Looking through ${total} public sources for specialists who see adults with ${who}… (${done} of ${total} done)`,
    detail: running ? `Right now: ${sourceName(running)}.` : "This usually takes a few minutes. You can leave this page open.",
    step: "search",
    tone: "working",
    progress: { done, total },
  };
}

function sourceName(run: PatientRun): string {
  return SOURCE_NAMES[run.agent] ?? "public sources";
}

function choosing(ctx: Ctx, found: number | null, partial: boolean): Omit<PatientStatus, "updatedAt"> {
  const { s } = ctx;
  const action: PatientNextAction = { kind: "pick_contacts", label: "Choose who to contact", detailsHref: details(s, "shortlist") };
  const detail = partial ? "A few searches didn't finish, so this list may be shorter than usual." : "We've suggested a few to start. Nothing is sent until you approve it.";
  if (found === 0) {
    return {
      headline: "We couldn't find anyone we could check against a public source yet.",
      detail: "Nothing was sent to anyone. The detailed view shows every source we read.",
      step: "choose",
      tone: "problem",
    };
  }
  if (found === null) {
    return { headline: `Your results are ready. Pick up to ${MAX_PICKS} to contact.`, detail, step: "choose", tone: "you", nextAction: action };
  }
  if (found === 1) {
    return { headline: "Found 1 person or program who can help. Pick them to get in touch.", detail, step: "choose", tone: "you", nextAction: action };
  }
  return {
    headline: `Found ${found} people and programs who can help. Pick up to ${MAX_PICKS} to contact.`,
    detail,
    step: "choose",
    tone: "you",
    nextAction: action,
  };
}

const TASK_WORDS: Record<string, { headline: (name: string) => string; label: string }> = {
  records: { headline: (n) => `${n} replied and needs your records. Tap to send them.`, label: "Send my records" },
  referral: { headline: (n) => `${n} replied and needs a referral from your doctor. Tap to see what they asked.`, label: "See what they asked" },
  slides: { headline: (n) => `${n} replied and asked for your slides. Tap to see what they asked.`, label: "See what they asked" },
  call: { headline: (n) => `${n} replied and asked you to call them. Tap to see the details.`, label: "See the details" },
  redirect: { headline: (n) => `${n} pointed us to a different contact. Tap to check it.`, label: "Check the new contact" },
  declined: { headline: (n) => `${n} said they can't help right now. Tap to close this and try someone else.`, label: "Close this" },
  unclear: { headline: (n) => `${n} replied. Take a look at what they said.`, label: "Read their reply" },
};

function reaching(ctx: Ctx): Omit<PatientStatus, "updatedAt"> {
  const { s } = ctx;
  const nameOf = (contactId: string | null) => s.contacts.find((c) => c.id === contactId)?.name ?? "A clinic";

  if (!s.plan || s.plan.status !== "approved") {
    const who = s.contacts.length === 1 ? s.contacts[0]!.name : `the ${s.contacts.length} you picked`;
    return {
      headline: `Here's how we'll reach ${who}. Take a look.`,
      detail: "We'll write each message for you to approve. Nothing is sent before that.",
      step: "reach",
      tone: "you",
      nextAction: { kind: "approve_plan", label: "Looks good", detailsHref: details(s, "plan") },
    };
  }

  const draftApplications = s.applications.filter((app) => app.status === "draft");
  const openTasks = s.tasks.filter((task) => task.status === "open");
  const task = openTasks.find((t) => t.kind !== "application");
  const applicationTask = openTasks.find((t) => t.kind === "application");

  if (task) return taskStatus(ctx, task, nameOf(task.contactId));

  const application = draftApplications.find((app) => app.contactId === applicationTask?.contactId) ?? draftApplications[0];
  if (application) {
    const name = nameOf(application.contactId);
    return {
      headline: `Your online form for ${name} is filled in. Take a look before it's sent.`,
      detail: "Only the details you ticked are in it.",
      step: "reach",
      tone: "you",
      nextAction: {
        kind: "approve_application",
        label: "Review the form",
        applicationId: application.id,
        ...(application.contactId ? { contactId: application.contactId } : {}),
        name,
        detailsHref: details(s, "outbox"),
      },
    };
  }

  const pending = s.contacts.find((c) => c.consented && (c.pendingDraftId || (c.state === "drafted" && !c.approved)));
  if (pending) {
    const call = pending.channel === "voice";
    return {
      headline: call
        ? `Your call script for ${pending.name} is ready. Take a look before we call.`
        : `Your message to ${pending.name} is ready. Take a look before it's sent.`,
      detail: "It only includes what you agreed to share, and says it was written with AI help.",
      step: "reach",
      tone: "you",
      nextAction: {
        kind: "approve_message",
        label: call ? "Read the call script" : "Read the message",
        contactId: pending.id,
        ...(pending.pendingDraftId ? { draftId: pending.pendingDraftId } : {}),
        name: pending.name,
        detailsHref: details(s, "outbox"),
      },
    };
  }

  return waiting(ctx);
}

function taskStatus(ctx: Ctx, task: PatientTask, name: string): Omit<PatientStatus, "updatedAt"> {
  const words = TASK_WORDS[task.kind] ?? TASK_WORDS.unclear!;
  return {
    headline: words.headline(name),
    detail: "Approving this never sends anything by itself. Any reply comes back to you first.",
    step: "reach",
    tone: "you",
    nextAction: {
      kind: "answer_task",
      label: words.label,
      taskId: task.id,
      taskKind: task.kind,
      contactId: task.contactId,
      name,
      detailsHref: details(ctx.s, "tracker"),
    },
  };
}

function waiting(ctx: Ctx): Omit<PatientStatus, "updatedAt"> {
  const { s } = ctx;
  const stalled = s.contacts.filter((c) => c.state === "stalled");
  const declined = s.contacts.filter((c) => c.state === "declined");
  const active = s.contacts.filter((c) => c.state !== "stalled" && c.state !== "declined");
  const stalledNote = stalled.length === 1 ? `${stalled[0]!.name} hasn't replied after two follow-ups.` : stalled.length > 1 ? `${stalled.length} people haven't replied after two follow-ups.` : undefined;
  const tryElse: PatientNextAction = { kind: "try_someone_else", label: "Pick someone else", detailsHref: details(s, "shortlist") };

  if (active.length === 0) {
    if (stalled.length > 0) {
      return {
        headline:
          stalled.length === 1
            ? `${stalled[0]!.name} hasn't replied after two follow-ups. Want to try someone else?`
            : `None of the ${stalled.length} people we wrote to have replied after two follow-ups. Want to try someone else?`,
        step: "reach",
        tone: "you",
        nextAction: tryElse,
      };
    }
    return {
      headline:
        declined.length === 1
          ? `${declined[0]!.name} said they can't help right now. Want to try someone else?`
          : "The people we wrote to can't help right now. Want to try someone else?",
      step: "reach",
      tone: "you",
      nextAction: tryElse,
    };
  }

  for (const state of GOOD_NEWS_ORDER) {
    const hit = active.find((c) => c.state === state);
    if (!hit) continue;
    const headline =
      state === "appointment_booked"
        ? `${hit.name} set up an appointment. Check your email for the details.`
        : state === "connected"
          ? `You're connected with ${hit.name}.`
          : state === "records_sent"
            ? `Your records are on their way to ${hit.name}.`
            : `${hit.name} replied. We're working out the next step.`;
    return { headline, ...(stalledNote ? { detail: stalledNote } : {}), step: "reach", tone: "good" };
  }

  const sent = active.filter((c) => c.state === "sent" || (c.state === "drafted" && c.approved));
  if (sent.length === 0) {
    return { headline: "We're keeping things moving.", ...(stalledNote ? { detail: stalledNote } : {}), step: "reach", tone: "waiting" };
  }
  const scheduled = sent.filter((c) => c.nextFollowUpAt).sort((a, b) => Date.parse(a.nextFollowUpAt!) - Date.parse(b.nextFollowUpAt!));
  const lead: PatientContact = scheduled[0] ?? sent[0]!;
  const others = sent.length - 1;
  const verb = lead.channel === "voice" ? "Called" : "Sent to";
  const subject = others > 0 ? `${verb} ${lead.name} and ${others} ${others === 1 ? "other" : "others"}` : `${verb} ${lead.name}`;
  const day = lead.nextFollowUpAt ? weekday(lead.nextFollowUpAt, ctx.timeZone) : null;
  const tail = day
    ? others > 0
      ? ` If no one replies, we'll follow up on ${day}.`
      : ` If they don't reply, we'll follow up on ${day}.`
    : others > 0
      ? " We'll let you know as soon as anyone replies."
      : " We'll let you know as soon as they reply.";
  return {
    headline: `${subject}.${tail}`,
    ...(stalledNote ? { detail: stalledNote } : {}),
    step: "reach",
    tone: "waiting",
  };
}

function details(s: PatientCaseSnapshot, page: string): string {
  return `/cases/${s.caseId}/${page}?view=judge`;
}

function weekday(iso: string, timeZone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(at);
}

function validTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function latestActivity(s: PatientCaseSnapshot): string | null {
  const stamps = [
    ...s.runs.flatMap((r) => [r.startedAt, r.finishedAt]),
    ...s.contacts.flatMap((c) => [c.lastActivityAt, c.firstSentAt, c.lastReplyAt]),
    ...s.applications.map((a) => a.submittedAt),
  ].filter((v): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v)));
  if (stamps.length === 0) return null;
  return new Date(Math.max(...stamps.map((v) => Date.parse(v)))).toISOString();
}
