/**
 * Input and output of the patient view's live status line. The snapshot is plain data read from the case's own
 * rows (case status, agent_runs, shortlist, contacts, consents, plan, tasks, web applications); the status is
 * computed from it by rules only, never by a model.
 */
export type PatientRunStatus = "queued" | "running" | "done" | "failed" | "not_implemented";

export interface PatientRun {
  agent: string;
  status: PatientRunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface PatientContact {
  id: string;
  name: string;
  channel: "email" | "voice";
  /** contact_state: drafted | sent | replied | task_open | records_sent | appointment_booked | connected | declined | stalled */
  state: string;
  consented: boolean;
  /** An outbound message to this contact has approved_at set. */
  approved: boolean;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  /** A drafted follow-up (contact still 'sent') is waiting for the patient's approval. */
  pendingFollowUp?: boolean;
  /** They asked for records or slides, and the reply letter we wrote is waiting for the patient's approval. */
  pendingReply?: "records" | "slides" | null;
  /** First time a message to this contact went out. */
  firstSentAt?: string | null;
  /** Latest reply received from this contact. */
  lastReplyAt?: string | null;
}

export interface PatientTask {
  id: string;
  contactId: string;
  kind: string;
  title: string;
  status: "open" | "approved" | "done";
  dueAt: string | null;
}

export interface PatientApplication {
  id: string;
  contactId: string | null;
  /** draft | approved | submitting | submitted | stale | refused | failed */
  status: string;
  submittedAt: string | null;
}

export interface PatientCaseSnapshot {
  caseId: string;
  found: boolean;
  caseStatus: string | null;
  diseaseName: string | null;
  runs: PatientRun[];
  /** How many public sources a full search reads (the swarm size). */
  expectedSources: number;
  /** Null when the shortlist could not be read. */
  shortlist: { total: number; suggested: number } | null;
  contacts: PatientContact[];
  tasks: PatientTask[];
  applications: PatientApplication[];
  plan: { status: "draft" | "approved" } | null;
}

export type PatientStep = "tell" | "search" | "choose" | "reach";

export const PATIENT_STEPS: readonly { id: PatientStep; label: string }[] = [
  { id: "tell", label: "Tell us" },
  { id: "search", label: "We search" },
  { id: "choose", label: "You choose" },
  { id: "reach", label: "We reach out" },
];

export type NextActionKind =
  | "confirm_details"
  | "retry_search"
  | "pick_contacts"
  | "share_details"
  | "approve_plan"
  | "approve_message"
  | "approve_application"
  | "answer_task"
  | "try_someone_else";

export interface PatientNextAction {
  kind: NextActionKind;
  /** Button text for the one primary action. */
  label: string;
  contactId?: string;
  taskId?: string;
  taskKind?: string;
  applicationId?: string;
  /** approve_message: this is a follow-up to someone already written to. */
  followUp?: boolean;
  /** approve_message: this answers their request for records or slides (a reply letter, not a follow-up). */
  reply?: "records" | "slides";
  /** approve_message: the other first messages and follow-ups also waiting, so skipping this one shows the next. */
  alsoWaiting?: { contactId: string; name: string }[];
  /** Who it is about, by name, when it is about one contact. */
  name?: string;
  /** The detailed page for this step. */
  detailsHref: string;
}

export type PatientTone = "working" | "you" | "waiting" | "good" | "problem";

export interface PatientStatus {
  headline: string;
  detail?: string;
  step: PatientStep;
  tone: PatientTone;
  nextAction?: PatientNextAction;
  /** Search progress while sources are being read. */
  progress?: { done: number; total: number };
  updatedAt: string;
}

export interface PatientTimelineItem {
  id: string;
  text: string;
  at: string | null;
}
