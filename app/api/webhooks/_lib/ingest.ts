import type { InboxDeps } from '../../../../lib/agents/inbox';
import { ingestInbound as ingestCaseDocument } from '../../../../lib/case-docs/hooks';
import { ingestInbound as ingestInboxTasks } from '../../../../lib/inbox/ingest';
import type { TaskStore } from '../../../../lib/inbox/task-store';
import type { InboxEvent } from '../../../../lib/inbox/thread-guard';

/** Verified, de-duplicated inbound message handed over by the webhook handlers. */
export interface WebhookInboundEvent {
  channel: 'email' | 'voice';
  contactId: string;
  caseId: string;
  body: string;
  /** AgentMail message id or AgentCall call id. */
  providerId: string;
  /** Email only: the thread the reply arrived on. */
  providerThreadId?: string;
  subject?: string;
  from?: string;
  receivedAt?: string;
}

export interface WebhookIngestDeps {
  /** Classifier, context loader and task store; lookupThread is supplied per event. */
  inbox: Omit<InboxDeps, 'lookupThread'> & { tasks: TaskStore };
  ingestTasks?: typeof ingestInboxTasks;
  storeDocument?: typeof ingestCaseDocument;
  now?: () => Date;
  onDocumentError?: (err: unknown) => void;
}

export function toInboxEvent(e: WebhookInboundEvent, now: () => Date = () => new Date()): InboxEvent {
  return {
    channel: e.channel,
    ...(e.channel === 'voice' ? { providerCallId: e.providerId } : { providerThreadId: e.providerThreadId }),
    ...(e.from !== undefined ? { from: e.from } : {}),
    ...(e.subject !== undefined ? { subject: e.subject } : {}),
    body: e.body,
    receivedAt: e.receivedAt ?? now().toISOString(),
  };
}

/**
 * Webhook-side adapter over the real inbox ingest. The webhook already resolved the owning contact from the
 * provider id, so the thread guard only confirms the event's own thread/call id maps to that contact.
 */
export function createWebhookIngest(deps: WebhookIngestDeps) {
  const ingestTasks = deps.ingestTasks ?? ingestInboxTasks;
  const storeDocument = deps.storeDocument ?? ingestCaseDocument;
  return async (e: WebhookInboundEvent) => {
    const event = toInboxEvent(e, deps.now);
    const known = event.providerCallId ?? event.providerThreadId;
    const result = await ingestTasks(event, {
      ...deps.inbox,
      lookupThread: key => ((key.providerCallId ?? key.providerThreadId) === known ? e.contactId : undefined),
    });
    // The case document store is best-effort: a failure must never fail (and so re-trigger) the webhook.
    try {
      await storeDocument(e.contactId, e.channel === 'voice' ? { transcript: e.body } : { body: e.body, title: e.subject });
    } catch (err) {
      (deps.onDocumentError ?? (x => console.error('Case document ingest failed:', x instanceof Error ? x.name : 'unknown')))(err);
    }
    return result;
  };
}
