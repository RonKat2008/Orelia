/** Live activity console: shared shapes. Everything here is JSON-safe (it travels over SSE and the polling route). */

export type ActivityKind =
  | "agent_started" | "agent_finished" | "agent_failed" | "contact_approved"
  | "email_sent" | "reply_received"
  | "call_queued" | "call_ringing" | "call_connected" | "call_turn" | "call_ended"
  | "browser_step" | "application_filled" | "application_submitted"
  | "task_created" | "follow_up_scheduled" | "follow_up_sent" | "agent_decision";

export interface ActivityEvent {
  /** Deterministic (e.g. `msg:<id>:sent`) so the client can dedupe across snapshots. */
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: ActivityKind;
  contactId: string | null;
  title: string;
  /** Untrusted text possible (replies, transcripts): render as plain text only. */
  detail?: string;
  imageUrl?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface CallTurn {
  seq: number;
  role: "ai" | "human";
  text: string;
  at: string | null;
}

export type LiveCallStatus = "queued" | "ringing" | "connected" | "ended";

export interface LiveCall {
  id: string;
  /** "vapi-web": a DEMO browser call (the presenter answered in the browser; same agent and pipeline). */
  provider: "vapi" | "vapi-web" | "agentcall" | null;
  status: LiveCallStatus;
  live: boolean;
  endedReason: string | null;
  summary: string | null;
  outcome: string | null;
  startedAt: string | null;
  endedAt: string | null;
  turns: CallTurn[];
  /** Judge view only (`?view=judge`). Stripped by `stripListenUrls` otherwise. Never log it. */
  listenUrl?: string;
}

export type LaneChannel = "email" | "voice" | "web";
export type LaneTargetKind = "expert" | "institution" | "trial" | "organization" | "unknown";

export interface ActivityLane {
  contactId: string;
  resourceName: string;
  targetKind: LaneTargetKind;
  channel: LaneChannel;
  /** Masked: a domain, or the last 4 digits of a phone. Never a full address. */
  destinationLabel: string;
  state: string;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  call: LiveCall | null;
  application: { status: string; screenshotUrl?: string; confirmation?: string } | null;
}

export interface ActivitySnapshot {
  caseId: string;
  now: string;
  lanes: ActivityLane[];
  /** Oldest first, newest last, capped at EVENT_CAP. */
  events: ActivityEvent[];
  /** Changes whenever lanes or events change (hash of content; `now` excluded). */
  cursor: string;
}

export interface SourceResult {
  events: ActivityEvent[];
  /** Partial lane facts keyed by `contactId`; later sources override earlier ones field by field. */
  lanes?: (Partial<ActivityLane> & { contactId: string })[];
}

export interface ActivitySource {
  name: string;
  load(caseId: string): Promise<SourceResult>;
}

/** Reads live call state (A: the `calls` row, B: call_live/call_turns). */
export interface CallLiveSource {
  name: "calls-row" | "call-live";
  load(caseId: string): Promise<CallRecord[]>;
}

export interface CallRecord extends LiveCall {
  contactId: string;
  /** When the call was approved/queued, if known. */
  queuedAt?: string | null;
}

export const EVENT_CAP = 300;
