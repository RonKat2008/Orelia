import { describe, expect, it } from 'vitest';
import { createWebhookIngest } from '../../app/api/webhooks/_lib/ingest';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import { mailBody, mailDeps, prodCtx, stubClassifier } from './_shared';

// A real reply that relays the office's clinical opinion. The model's one-line rationale paraphrases it.
const BODY = "We can't take this case. Dr. Smith recommends continuing chemotherapy with the local team.";

describe('reply whose classifier rationale trips the medical-advice screen', () => {
  it('is still ingested (task + reply event) instead of failing with 500 on every redelivery', async () => {
    const tasks = new MemoryTaskStore();
    const ingest = createWebhookIngest({
      inbox: {
        classifier: stubClassifier({ class: 'declined', confidence: 0.9, rationale: 'Declined; Dr. Smith recommends continuing chemotherapy locally.' }),
        loadContext: () => prodCtx, tasks,
      },
      storeDocument: (async () => undefined) as never,
    });
    const { handle, events } = mailDeps(ingest);
    const first = await handle(mailBody({ text: BODY }));
    const retry = await handle(mailBody({ text: BODY }));
    // Today both are 500 (MedicalAdviceInDraft thrown from draftTasks): no task, no contact/reply event, so the
    // contact stays 'sent' and automated follow-ups keep going to someone who already answered.
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(tasks.rows.size).toBe(1);
    expect(events.map(e => e.name)).toContain('contact/reply');
  });
});
