import type { PatientStatus } from "@/lib/patient-status/types";
import { OUTBOX_COPY } from "./copy";

export type OutboxScreen = "message" | "form" | "consent" | "empty";

/** One message per screen: the status's next action decides which screen shows. */
export function outboxScreen(status: PatientStatus): OutboxScreen {
  switch (status.nextAction?.kind) {
    case "approve_message":
      return "message";
    case "approve_application":
      return "form";
    case "share_details":
      return "consent";
    default:
      return "empty";
  }
}

/** Who the consent question is about, from the status headline ("Choose what we may share with X."). */
export function consentName(status: PatientStatus): string {
  const match = /share with (.+?)\.?$/.exec(status.headline);
  return match?.[1]?.trim() || OUTBOX_COPY.fallbackName;
}

/** Changes when the next action changes, so a new message starts with fresh state. */
export function outboxKey(status: PatientStatus): string {
  const a = status.nextAction;
  if (!a) return "none";
  return [a.kind, a.contactId, a.taskId, a.applicationId, a.followUp ? "f" : ""].join(":");
}
