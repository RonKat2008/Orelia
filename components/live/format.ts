import type { ActivityEvent, ActivityKind } from "@/lib/activity/types";

const pad = (n: number) => String(n).padStart(2, "0");

/** "Follow-up in 2d 4h 03m 12s"; "Follow-up due now" once the time has passed. Pure. */
export function countdownLabel(targetIso: string | null, nowMs: number): string | null {
  if (!targetIso) return null;
  const target = Date.parse(targetIso);
  if (Number.isNaN(target)) return null;
  const total = Math.floor((target - nowMs) / 1000);
  if (total <= 0) return "Follow-up due now";
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = d > 0 ? [`${d}d`, `${h}h`, `${pad(m)}m`, `${pad(s)}s`] : h > 0 ? [`${h}h`, `${pad(m)}m`, `${pad(s)}s`] : [`${m}m`, `${pad(s)}s`];
  return `Follow-up in ${parts.join(" ")}`;
}

/** "just now", "42s ago", "5m ago", "3h ago", "2d ago". Pure. */
export function relativeTime(iso: string | null, nowMs: number): string {
  if (!iso) return "no activity yet";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "no activity yet";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const STATE_LABEL: Record<string, string> = {
  drafted: "Drafted", sent: "Waiting for reply", replied: "Replied", task_open: "Needs you", records_sent: "Records sent",
  appointment_booked: "Booked", connected: "Connected", declined: "Declined", stalled: "Stalled",
  call_queued: "Call queued", call_ringing: "Ringing", call_connected: "On call", call_ended: "Call ended",
  draft: "Draft ready", approved: "Approved", submitting: "Submitting", submitted: "Submitted", stale: "Form changed", refused: "Refused", failed: "Failed",
};
export const stateLabel = (state: string): string => STATE_LABEL[state] ?? state.replace(/_/g, " ");

export type StateTone = "neutral" | "teal" | "ok" | "warn" | "danger" | "call" | "email";
export function stateTone(state: string): StateTone {
  if (state === "call_ringing" || state === "call_queued") return "call";
  if (["call_connected", "replied", "connected", "appointment_booked", "submitted", "records_sent"].includes(state)) return "ok";
  if (["task_open", "stalled", "stale"].includes(state)) return "warn";
  if (["declined", "failed", "refused"].includes(state)) return "danger";
  if (state === "sent") return "email";
  return "neutral";
}

/** Which timeline events are hidden by default (the live call panel already shows transcript turns). */
export const isTranscriptTurn = (e: ActivityEvent): boolean => e.kind === "call_turn";

export const KIND_LABEL: Record<ActivityKind, string> = {
  agent_started: "Agent started", agent_finished: "Agent finished", agent_failed: "Agent failed", contact_approved: "Approved",
  email_sent: "Email sent", reply_received: "Reply", call_queued: "Call queued", call_ringing: "Ringing", call_connected: "Connected",
  call_turn: "Transcript", call_ended: "Call ended", browser_step: "Browser", application_filled: "Form filled",
  application_submitted: "Submitted", task_created: "Task", follow_up_scheduled: "Follow-up set", follow_up_sent: "Follow-up sent", agent_decision: "Decision",
};
