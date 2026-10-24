import { describe, expect, it } from 'vitest';
import { createWebhookIngest } from '../../app/api/webhooks/_lib/ingest';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import { OWNER, prodCtx, stubClassifier } from './_shared';

const STORED_ID = '33333333-3333-4333-8333-333333333333';
const BODY = 'We cannot schedule this. Please contact our intake team at intake@other-clinic.example for help.';

describe('webhook redirect task grounding', () => {
  it('a redirect task created by the webhook carries the stored inbound messageId (needed by approveTask)', async () => {
    const tasks = new MemoryTaskStore();
    const ingest = createWebhookIngest({
      inbox: {
        classifier: stubClassifier({ class: 'redirect', confidence: 0.9, rationale: 'Redirected to intake.', redirect: { name: 'Intake', email: 'intake@other-clinic.example' } }),
        loadContext: () => prodCtx, tasks,
      },
      storeDocument: (async () => undefined) as never,
    });
    const res = await ingest({ channel: 'email', contactId: OWNER.contactId, caseId: OWNER.caseId, body: BODY, providerId: 'pm-1', providerThreadId: 'thread-1', messageId: STORED_ID });
    const task = res.tasks[0]!;
    expect(task.kind).toBe('redirect');
    // approveTask refuses with redirect_unverified when details.messageId is missing, so every real redirect is unapprovable.
    expect(task.details?.messageId).toBe(STORED_ID);
  });
});

describe('webhook handler passes the stored row id to ingest', () => {
  it('forwards storeInboundMessage id as event.messageId (also for a duplicate)', async () => {
    const { mailDeps, mailBody } = await import('./_shared');
    const seen: Array<string | undefined> = [];
    const m = mailDeps(async e => { seen.push(e.messageId); return {}; });
    m.deps.storeInboundMessage = async () => ({ status: 'stored', id: STORED_ID });
    await m.handle(mailBody({ text: 'hello' }));
    expect(seen).toEqual([STORED_ID]);
  });
});
