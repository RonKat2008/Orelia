/**
 * Engine-neutral workflow types. Models the subset of Inngest v3's step API we
 * use, so the real `step` object can be passed straight in once the package lands.
 */

export interface WorkflowStep {
  run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
  /** Resolves to the matching event, or null on timeout. */
  waitForEvent<E = unknown>(
    id: string,
    opts: { event: string; timeout: string | number | Date; if?: string },
  ): Promise<E | null>;
  sendEvent(
    id: string,
    payload:
      | { name: string; data: Record<string, unknown> }
      | { name: string; data: Record<string, unknown> }[],
  ): Promise<unknown>;
}

export const CONTACT_CREATED = 'contact/created';
export const CONTACT_APPROVED = 'contact/approved';
export const CONTACT_REPLY = 'contact/reply';
export const FOLLOW_UP_DRAFTED = 'contact/follow-up.drafted';
export const FOLLOW_UP_APPROVED = 'contact/follow-up.approved';
export const CONTACT_STALLED = 'contact/stalled';

interface Base {
  contactId: string;
  caseId: string;
}
export type ContactCreatedData = Base;
export interface ContactApprovedData extends Base {
  messageId: string;
  /** ISO timestamp of the human approval. */
  approvedAt: string;
}
export interface ContactReplyData extends Base {
  messageId?: string;
}
export interface FollowUpDraftedData extends Base {
  messageId: string;
  followUpNumber: 1 | 2;
}
export interface FollowUpApprovedData extends Base {
  messageId: string;
  /** ISO timestamp of the human approval. */
  approvedAt: string;
}
export type ContactStalledData = Base;

/** Engine-neutral function description; a thin adapter registers it with Inngest. */
export type FunctionDefinition = {
  id: string;
  trigger: { event: string };
  handler: (ctx: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads are validated by each handler
    event: { name: string; data: any };
    step: WorkflowStep;
  }) => Promise<unknown>;
};
