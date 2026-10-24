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
export type SendEvents = ((events: WorkflowEvent | WorkflowEvent[]) => Promise<void>) & {
  /**
   * True when events are handed to a durable engine (Inngest) that acts on them later. Otherwise (inline, tests)
   * an event's effect has already happened, or failed, by the time the call returns.
   */
  durable?: boolean;
};

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
  const send: SendEvents = async (events) => {
    // Fail closed: without Inngest nothing is queued, so no follow-up or send can happen.
    const devServer = (process.env.INNGEST_DEV ?? '') !== '' && process.env.INNGEST_DEV !== '0';
    if (!devServer && !(process.env.INNGEST_EVENT_KEY ?? '').trim()) {
      throw new Error('Inngest is not configured (INNGEST_EVENT_KEY); workflow events are refused and nothing is sent');
    }
    const { inngest } = await import('./inngest');
    await inngest.send(events as Parameters<typeof inngest.send>[0]);
  };
  send.durable = true;
  return send;
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
