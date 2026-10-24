import type { InboxDeps } from '../../../../lib/agents/inbox';
import { ingestInbound as ingestCaseDocument } from '../../../../lib/case-docs/hooks';
import { ingestInbound as ingestInboxTasks } from '../../../../lib/inbox/ingest';
import { MedicalAdviceInDraft, NEUTRAL_RATIONALE } from '../../../../lib/inbox/drafts';
import type { StoredTask, TaskStore } from '../../../../lib/inbox/task-store';
import type { InboxEvent } from '../../../../lib/inbox/thread-guard';

/** Verified, de-duplicated inbound message handed over by the webhook handlers. */
export interface WebhookInboundEvent {
  channel: 'email' | 'voice';
  contactId: string;
  caseId: string;
  body: string;
  /** AgentMail message id or AgentCall call id. */
  providerId: string;
  /** Email only: stored messages.id (uuid) of this inbound reply; lets a redirect task be approved against the stored message. */
  messageId?: string;
  /** Email only: the thread the reply arrived on. */
  providerThreadId?: string;
  subject?: string;
  from?: string;
  receivedAt?: string;
  /** Recorded on the tasks this event creates (tasks.source_id) so a retried ingest can detect them. */
  sourceId?: string;
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
    ...(e.messageId !== undefined ? { messageId: e.messageId } : {}),
    body: e.body,
    receivedAt: e.receivedAt ?? now().toISOString(),
    ...(e.sourceId !== undefined ? { sourceId: e.sourceId } : {}),
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
    const run = (inbox: WebhookIngestDeps['inbox']) => ingestTasks(event, {
      ...inbox,
      // The document is stored once, best-effort, below; processInbound must not store (and fail on) it again.
      skipDocumentIngest: true,
      lookupThread: key => ((key.providerCallId ?? key.providerThreadId) === known ? e.contactId : undefined),
    });
    let result;
    try {
      result = await run(deps.inbox);
    } catch (err) {
      // A draft flagged for medical advice (the model paraphrasing the office's clinical opinion) must not 500 on every
      // redelivery. Fall back to an `unclear` review task with a neutral rationale; the flagged text is never kept.
      if (!(err instanceof MedicalAdviceInDraft)) throw err;
      result = await run({ ...deps.inbox, classifier: { classify: async () => ({ class: 'unclear', confidence: 1, rationale: NEUTRAL_RATIONALE }) } });
    }
    // The case document store is best-effort: a failure must never fail (and so re-trigger) the webhook.
    try {
      await storeDocument(e.contactId, e.channel === 'voice' ? { transcript: e.body } : { body: e.body, title: e.subject });
    } catch (err) {
      (deps.onDocumentError ?? (x => console.error('Case document ingest failed:', x instanceof Error ? x.name : 'unknown')))(err);
    }
    return result;
  };
}

/** Stable task source for one inbound event: the email's provider message id or the call id. */
export function ingestSourceId(e: Pick<WebhookInboundEvent, 'channel' | 'providerId'>): string {
  return `${e.channel}:${e.providerId}`;
}

/**
 * Makes a webhook ingest safe to re-run after a partial failure (e.g. tasks saved, then the reply event failed):
 * when tasks already exist for this event's source, classification and task creation are skipped.
 */
export function idempotentIngest<R>(
  tasks: { tasksForSource(sourceId: string): Promise<StoredTask[]> },
  run: (e: WebhookInboundEvent, sourceId: string) => Promise<R>,
) {
  return async (e: WebhookInboundEvent): Promise<R | { replayed: true; contactId: string; tasks: StoredTask[] }> => {
    const sourceId = ingestSourceId(e);
    const existing = await tasks.tasksForSource(sourceId);
    if (existing.length) return { replayed: true, contactId: e.contactId, tasks: existing };
    return run(e, sourceId);
  };
}
