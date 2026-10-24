import type { Draft } from "@/lib/contracts";
import type { ShareableFieldKey } from "./fields";

export const CONTACT_STATES = [
  "drafted",
  "sent",
  "replied",
  "task_open",
  "records_sent",
  "appointment_booked",
  "connected",
  "declined",
  "stalled",
] as const;

export type ContactState = (typeof CONTACT_STATES)[number];

export const STATE_LABELS: Record<ContactState, string> = {
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
  task_open: "Task open",
  records_sent: "Records sent",
  appointment_booked: "Appointment booked",
  connected: "Connected",
  declined: "Declined",
  stalled: "Stalled",
};

export type OutreachContact = {
  id: string;
  name: string;
  role: string;
  channel: "email" | "voice";
  address: string;
  state: ContactState;
  nextFollowUpAt: string | null;
};

export type OutreachDraft = {
  id: string;
  contactId: string;
  contactName: string;
  draft: Draft;
  sharedFields: ShareableFieldKey[];
  approvedAt: string | null;
  rejected: boolean;
};

export type OutreachTask = {
  id: string;
  contactId: string;
  contactName: string;
  kind: "referral" | "slides" | "records" | "call" | "redirect" | "unclear" | "declined";
  summary: string;
  status: "open" | "approved" | "done";
  dueAt: string | null;
};

export const TASK_KIND_LABELS: Record<OutreachTask["kind"], string> = {
  referral: "Referral request",
  slides: "Slide request",
  records: "Records packet",
  call: "Call to schedule",
  redirect: "Redirect",
  unclear: "Needs a look",
  declined: "Declined",
};
