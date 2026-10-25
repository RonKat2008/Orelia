import { caseDocsTool } from '../case-docs/tool';
import { libraryDocsTool } from '../accounts/tool';
import type { DocumentStore } from '../case-docs';
import { ingestInbound as ingestDocument } from '../case-docs/hooks';
import type { InboxClassifier } from '../inbox/classifier';
import { draftTasks, type DraftContext, type TaskDraft } from '../inbox/drafts';
import type { InboxClassification } from '../inbox/schema';
import { groundPhones } from '../inbox/phone-ground';
import { parseSender } from '../inbox/sender';
import { assertWayfinderThread, type InboxEvent, type ThreadLookup } from '../inbox/thread-guard';

export const MIN_CONFIDENCE = 0.5;
export interface InboxDeps {
  documents?: DocumentStore;
  classifier: InboxClassifier;
  lookupThread: ThreadLookup;
  /** The caller stores the case document itself (the webhook adapter does, best-effort). */
  skipDocumentIngest?: boolean;
  loadContext(contactId: string): DraftContext | Promise<DraftContext>;
}
export interface InboxResult { contactId: string; classification: InboxClassification; tasks: TaskDraft[] }

export async function processInbound(event: InboxEvent, deps: InboxDeps): Promise<InboxResult> {
  const contactId = await assertWayfinderThread(event, deps.lookupThread);
  const ctx = await deps.loadContext(contactId);
  // Thread ownership is established before any document write or model access.
  if (!deps.skipDocumentIngest) {
    await ingestDocument(contactId, event.channel === 'voice' ? { transcript: event.body } : { body: event.body }, {
      store: deps.documents, resolveContact: async () => ({ caseId: ctx.caseId }),
    });
  }
  const contextDocIds = new Set<string>();
  const tool = caseDocsTool(ctx.caseId, contactId, ctx.consent.sharedFields, deps.documents);
  const handler = tool.handler;
  const tools = [{ ...tool, handler: async (input: never) => {
    const results = await handler(input);
    if (Array.isArray(results)) for (const row of results) {
      if (row && typeof row.id === 'string') contextDocIds.add(row.id);
    }
    return results;
  } }, libraryDocsTool(ctx.caseId, 'inbox')];
  const raw = await deps.classifier.classify({ channel: event.channel, body: event.body, subject: event.subject, from: event.from, caseId: ctx.caseId, offlineKey: event.offlineKey, tools });
  // Whatever produced the classification (model, fixture), a phone survives only if it is in the message itself.
  const grounded = groundPhones(raw, event.body);
  const classification: InboxClassification = grounded.confidence < MIN_CONFIDENCE && grounded.class !== 'unclear'
    ? { ...grounded, class: 'unclear', rationale: `Low confidence (${grounded.confidence}); needs your review.` }
    : grounded;
  const replyTo = event.channel === 'email' ? parseSender(event.from) : undefined;
  return { contactId, classification, tasks: draftTasks(classification, { ...ctx, ...(replyTo ? { replyTo } : {}), contactId, messageId: event.messageId, contextDocIds: [...contextDocIds], coordinatorQuestion: event.body }) };
}
