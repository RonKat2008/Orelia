import type { InboxClassifier } from '../inbox/classifier';
import { draftTasks, type DraftContext, type TaskDraft } from '../inbox/drafts';
import type { InboxClassification } from '../inbox/schema';
import { assertWayfinderThread, type InboxEvent, type ThreadLookup } from '../inbox/thread-guard';

export const MIN_CONFIDENCE = 0.5;
export interface InboxDeps {
  classifier: InboxClassifier;
  lookupThread: ThreadLookup;
  loadContext(contactId: string): DraftContext | Promise<DraftContext>;
}
export interface InboxResult { contactId: string; classification: InboxClassification; tasks: TaskDraft[] }

export async function processInbound(event: InboxEvent, deps: InboxDeps): Promise<InboxResult> {
  const contactId = await assertWayfinderThread(event, deps.lookupThread);
  const ctx = await deps.loadContext(contactId);
  const raw = await deps.classifier.classify({ channel: event.channel, body: event.body, subject: event.subject, from: event.from, caseId: ctx.caseId, offlineKey: event.offlineKey });
  const classification: InboxClassification = raw.confidence < MIN_CONFIDENCE && raw.class !== 'unclear'
    ? { ...raw, class: 'unclear', rationale: `Low confidence (${raw.confidence}); needs your review.` }
    : raw;
  return { contactId, classification, tasks: draftTasks(classification, { ...ctx, contactId }) };
}
