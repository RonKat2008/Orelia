/**
 * Shared workflow event builders. Event ids make Inngest dedupe retried sends,
 * so a double-clicked approve or a replayed webhook triggers the workflow once.
 */
import { CONTACT_APPROVED, CONTACT_REPLY, FOLLOW_UP_APPROVED } from './engine';

export interface WorkflowEvent {
  name: string;
  data: Record<string, unknown>;
  id?: string;
}
export type SendEvents = (events: WorkflowEvent | WorkflowEvent[]) => Promise<void>;

export function contactApprovedEvent(d: {
  contactId: string;
  caseId: string;
  messageId: string;
  approvedAt: string;
}): WorkflowEvent {
  return { name: CONTACT_APPROVED, id: `contact-approved-${d.messageId}`, data: { ...d } };
}

export function contactReplyEvent(d: {
  contactId: string;
  caseId: string;
  dedupeKey: string;
  messageId?: string;
  callId?: string;
  receivedAt: string;
}): WorkflowEvent {
  return { name: CONTACT_REPLY, id: `contact-reply-${d.dedupeKey}`, data: { ...d } };
}

export function followUpApprovedEvent(d: {
  contactId: string;
  caseId: string;
  messageId: string;
  approvedAt: string;
}): WorkflowEvent {
  return { name: FOLLOW_UP_APPROVED, id: `follow-up-approved-${d.messageId}`, data: { ...d } };
}

/** Real sender backed by the Inngest client (lazy import keeps tests offline). */
export function inngestSendEvents(): SendEvents {
  return async (events) => {
    const { inngest } = await import('./inngest');
    await inngest.send(events as Parameters<typeof inngest.send>[0]);
  };
}

export const noopSendEvents: SendEvents = async () => {};

export function recordingSendEvents(): { send: SendEvents; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = [];
  return {
    events,
    send: async (e) => {
      events.push(...(Array.isArray(e) ? e : [e]));
    },
  };
}
