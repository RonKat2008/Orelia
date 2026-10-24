import { caseDocsTool } from '../case-docs/tool';
import type { DocumentStore } from '../case-docs';
import { ingestInbound as ingestDocument } from '../case-docs/hooks';
import type { InboxClassifier } from '../inbox/classifier';
import { draftTasks, type DraftContext, type TaskDraft } from '../inbox/drafts';
import type { InboxClassification } from '../inbox/schema';
import { assertWayfinderThread, type InboxEvent, type ThreadLookup } from '../inbox/thread-guard';

export const MIN_CONFIDENCE = 0.5;
export interface InboxDeps {
  documents?: DocumentStore;
  classifier: InboxClassifier;
  lookupThread: ThreadLookup;
  loadContext(contactId: string): DraftContext | Promise<DraftContext>;
}
export interface InboxResult { contactId: string; classification: InboxClassification; tasks: TaskDraft[] }

export async function processInbound(event: InboxEvent, deps: InboxDeps): Promise<InboxResult> {
  const contactId = await assertWayfinderThread(event, deps.lookupThread);
  const ctx = await deps.loadContext(contactId);
  // Thread ownership is established before any document write or model access.
  await ingestDocument(contactId, event.channel === 'voice' ? { transcript: event.body } : { body: event.body }, {
    store: deps.documents, resolveContact: async () => ({ caseId: ctx.caseId }),
  });
  const contextDocIds = new Set<string>();
  const tool = caseDocsTool(ctx.caseId, contactId, ctx.consent.sharedFields, deps.documents);
  const handler = tool.handler;
  const tools = [{ ...tool, handler: async (input: never) => {
    const results = await handler(input);
    if (Array.isArray(results)) for (const row of results) {
      if (row && typeof row.id === 'string') contextDocIds.add(row.id);
    }
    return results;
  } }];
  const raw = await deps.classifier.classify({ channel: event.channel, body: event.body, subject: event.subject, from: event.from, caseId: ctx.caseId, offlineKey: event.offlineKey, tools });
  const classification: InboxClassification = raw.confidence < MIN_CONFIDENCE && raw.class !== 'unclear'
    ? { ...raw, class: 'unclear', rationale: `Low confidence (${raw.confidence}); needs your review.` }
    : raw;
  return { contactId, classification, tasks: draftTasks(classification, { ...ctx, contactId, messageId: event.messageId, contextDocIds: [...contextDocIds], coordinatorQuestion: event.body }) };
}
