import { describe, expect, it } from 'vitest';
import { createWebhookIngest } from '../../app/api/webhooks/_lib/ingest';
import { captureAppointment } from '../../lib/appointments/capture';
import { MemoryAppointmentStore } from '../../lib/appointments/store';
import { FixtureClassifier } from '../../lib/inbox/classifier';
import type { DraftContext } from '../../lib/inbox/drafts';
import { MemoryTaskStore } from '../../lib/inbox/task-store';

const ctx: DraftContext = {
  contactId: '11111111-1111-4111-8111-111111111111', caseId: '22222222-2222-4222-8222-222222222222', resourceName: 'Example Clinic',
  consent: { sharedFields: [] }, caseRecord: {},
};
const event = {
  channel: 'email' as const, contactId: ctx.contactId, caseId: ctx.caseId, providerId: 'pm-77', providerThreadId: 'thread-1',
  receivedAt: '2026-10-24T19:00:00.000Z',
  body: 'We can see you Tuesday Nov 10 at 2:30pm ET at our Cleveland office, 9500 Euclid Ave',
};

describe('webhook ingest -> proposed appointment', () => {
  it('creates a proposed (never confirmed) appointment alongside the inbox tasks', async () => {
    const store = new MemoryAppointmentStore();
    store.owners.set(ctx.caseId, 'owner-1');
    const ingest = createWebhookIngest({
      inbox: { classifier: new FixtureClassifier(), loadContext: () => ctx, tasks: new MemoryTaskStore() },
      storeDocument: (async () => undefined) as never,
      captureAppointment: e => captureAppointment(e, { store, loadContext: async () => ({ resourceName: 'Example Clinic', resourceAddress: 'Cleveland, OH' }) }),
    });
    const result = await ingest(event);
    expect(result.tasks.length).toBeGreaterThan(0);
    const [appt] = await store.listForCase(ctx.caseId);
    expect(appt).toMatchObject({ status: 'proposed', source: 'reply', sourceMessageId: 'email:pm-77', ownerKey: 'owner-1', title: 'Appointment with Example Clinic', location: '9500 Euclid Ave' });
    expect(appt.candidates[0].startsAt).toBe('2026-11-10T19:30:00.000Z');
  });

  it('a capture failure never fails the webhook ingest', async () => {
    const errors: unknown[] = [];
    const ingest = createWebhookIngest({
      inbox: { classifier: new FixtureClassifier(), loadContext: () => ctx, tasks: new MemoryTaskStore() },
      storeDocument: (async () => undefined) as never,
      captureAppointment: async () => { throw new Error('db down'); },
      onCaptureError: e => errors.push(e),
    });
    await expect(ingest(event)).resolves.toBeDefined();
    expect(errors).toHaveLength(1);
  });
});
