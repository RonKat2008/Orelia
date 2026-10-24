import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { draftTasks } from '../../lib/inbox/drafts';
import { inboxClassificationSchema } from '../../lib/inbox/schema';
import { processInbound } from '../../lib/agents/inbox';
import { prodCtx, stubClassifier } from './_shared';

describe('redirect with only a phone number ("call this number")', () => {
  const fx = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'inbox', '10-redirect-voice-coordinator.json'), 'utf8'));
  const c = inboxClassificationSchema.parse(fx.expected);
  it('produces an actionable task that shows the number (not an email letter with no recipient)', () => {
    const [task] = draftTasks(c, prodCtx);
    const actionable = task!.kind === 'call' || !!task!.letter?.to;
    expect(actionable).toBe(true);
    expect(`${task!.title}\n${task!.draftBody ?? ''}`).toContain('202-555-0189');
  });
  it('a phone that is not in the call transcript is dropped, and the task asks the patient to look it up', async () => {
    const event = { channel: 'voice' as const, providerCallId: 'call-1', body: fx.event.body, receivedAt: '2026-10-29T15:04:00Z' };
    const invented = { ...c, redirect: { name: 'Alicia Brandt', phone: '202-555-0100' } };
    const r = await processInbound(event, { classifier: stubClassifier(invented), lookupThread: () => prodCtx.contactId, loadContext: () => prodCtx, skipDocumentIngest: true });
    const task = r.tasks[0]!;
    expect(task.kind).toBe('call');
    expect(task.title).toBe('Look up a phone number for Alicia Brandt');
    expect(`${task.title}\n${task.draftBody}`).not.toContain('202-555-0100');
    expect(task.details).toMatchObject({ lookupNumber: true });
  });
});
