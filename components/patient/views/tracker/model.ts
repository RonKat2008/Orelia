import type { ApiContact } from "@/components/outreach/client";
import type { OutreachTask } from "@/components/outreach/types";
import type { PatientStatus } from "@/lib/patient-status/types";
import { TRACKER_COPY as copy } from "./copy";

export type StatusWord = keyof typeof copy.words;
export type StatusIcon = "send" | "reply" | "alert" | "clock" | "minus" | "calendar" | "draft";

export const STATUS_ICON: Record<StatusWord, StatusIcon> = {
  sent: "send",
  replied: "reply",
  needsYou: "alert",
  noReply: "clock",
  cantHelp: "minus",
  booked: "calendar",
  notSent: "draft",
};

/** Actions in the status that mean "this contact needs the patient". */
const NEEDS_YOU_ACTIONS = new Set(["answer_task", "approve_message", "approve_application"]);

/** Contact ids that need the patient: an open task, a follow-up awaiting approval, or the status's own next action. */
export function needsYouIds(contacts: readonly ApiContact[], tasks: readonly OutreachTask[], status: PatientStatus | null): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) if (task.status === "open") ids.add(task.contactId);
  for (const contact of contacts) if (contact.followUpAwaitingApproval) ids.add(contact.id);
  const action = status?.nextAction;
  if (action?.contactId && NEEDS_YOU_ACTIONS.has(action.kind)) ids.add(action.contactId);
  return ids;
}

/** One plain status word per contact. Internal state names never reach the patient. */
export function statusWord(contact: Pick<ApiContact, "state" | "nextFollowUpAt">, needsYou: boolean): StatusWord {
  if (needsYou) return "needsYou";
  switch (contact.state) {
    case "drafted":
      return "notSent";
    case "sent":
      return contact.nextFollowUpAt ? "noReply" : "sent";
    case "stalled":
      return "noReply";
    case "declined":
      return "cantHelp";
    case "appointment_booked":
      return "booked";
    case "records_sent":
      return "sent";
    default:
      return "replied";
  }
}

/** "Mon 27 Oct", in the given time zone (the patient's own, by default). */
export function shortDay(iso: string | null | undefined, timeZone?: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  } catch {
    return null;
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "We'll follow up on Mon 27 Oct", or null when nothing is planned (or the contact is finished). */
export function followUpLine(contact: Pick<ApiContact, "state" | "nextFollowUpAt">, timeZone?: string): string | null {
  if (contact.state === "declined" || contact.state === "stalled") return null;
  const day = shortDay(contact.nextFollowUpAt, timeZone);
  return day ? copy.followUp(day) : null;
}

/** The lines inside one row's Details: how we reached them, the last message, the follow-up date. */
export function detailLines(contact: ApiContact, tasks: readonly OutreachTask[], timeZone?: string): string[] {
  const lines: string[] = [];
  if (contact.state !== "drafted") lines.push(copy.sentVia(contact.channel));
  const task = tasks.find((t) => t.contactId === contact.id);
  if (task?.summary) lines.push(copy.lastMessage(task.summary));
  else if (contact.state === "stalled") lines.push(copy.stalledLine);
  else if (["replied", "task_open", "records_sent", "appointment_booked", "connected"].includes(contact.state)) lines.push(copy.repliedLine);
  else lines.push(copy.noMessage);
  lines.push(followUpLine(contact, timeZone) ?? copy.noFollowUp);
  return lines;
}

/** Needs-you contacts first, then the rest in the order given. Returns a new array. */
export function orderContacts(contacts: readonly ApiContact[], needs: ReadonlySet<string>): ApiContact[] {
  return [...contacts].sort((a, b) => Number(needs.has(b.id)) - Number(needs.has(a.id)));
}

/** The one primary: only when the status's next action is something the patient must do for a contact. */
export function trackerPrimary(status: PatientStatus | null): { label: string; contactId?: string } | null {
  const action = status?.nextAction;
  if (!action || !NEEDS_YOU_ACTIONS.has(action.kind)) return null;
  return { label: action.label, ...(action.contactId ? { contactId: action.contactId } : {}) };
}
