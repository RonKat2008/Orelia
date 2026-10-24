import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAppointment, stateFromAddress, type CaptureDeps } from '@/lib/appointments/capture';
import { AppointmentError, confirm, createManual, dismiss, markCancelled, sweepReminders } from '@/lib/appointments/service';
import { MemoryAppointmentStore } from '@/lib/appointments/store';
import type { Appointment } from '@/lib/appointments/schema';
import type { CalendarSync } from '@/lib/integrations/google/connection';
import { CASE_ID } from './fixtures';

const REPLY = 'We can see you Tuesday Nov 10 at 2:30pm ET at our Cleveland office, 9500 Euclid Ave';
const RECEIVED = '2026-10-24T19:00:00Z';
const CONTACT = '55555555-5555-4555-8555-555555555555';

let store: MemoryAppointmentStore;
let captureDeps: CaptureDeps;

beforeEach(() => {
  store = new MemoryAppointmentStore();
  store.owners.set(CASE_ID, 'owner-1');
  captureDeps = { store, loadContext: async () => ({ resourceName: 'Cleveland Clinic', resourceAddress: 'Cleveland, OH' }) };
});

const capture = (body = REPLY, providerId = 'msg-1') =>
  captureAppointment({ channel: 'email', caseId: CASE_ID, contactId: CONTACT, body, providerId, receivedAt: RECEIVED }, captureDeps);

function fakeSync() {
  return {
    upsert: vi.fn(async (_o: string, a: Appointment) => a.googleEventId ?? 'evt-1'),
    remove: vi.fn(async () => undefined),
    freeTimes: vi.fn(async () => []),
    disconnect: vi.fn(async () => undefined),
  } satisfies CalendarSync;
}

describe('captureAppointment', () => {
  it('creates a proposed appointment from the demo reply', async () => {
    const out = await capture();
    expect(out?.created).toBe(true);
    const a = out!.appointment;
    expect(a.status).toBe('proposed');
    expect(a.candidates.map(c => c.startsAt)).toEqual(['2026-11-10T19:30:00.000Z']);
    expect(a.location).toBe('9500 Euclid Ave');
    expect(a.ownerKey).toBe('owner-1');
    expect(a.sourceMessageId).toBe('email:msg-1');
    expect(a.title).toContain('Cleveland Clinic');
  });

  it('is idempotent for the same provider id', async () => {
    const first = await capture();
    const second = await capture();
    expect(second?.created).toBe(false);
    expect(second?.appointment.id).toBe(first?.appointment.id);
    expect(store.rows.size).toBe(1);
  });

  it('returns null when the reply has no time', async () => {
    expect(await capture('Thanks for reaching out, we will get back to you soon.')).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  it('leaves ownerKey null for an unowned case', async () => {
    store.owners.set(CASE_ID, null);
    expect((await capture())!.appointment.ownerKey).toBeNull();
  });
});

describe('stateFromAddress', () => {
  it('reads a trailing state code', () => {
    expect(stateFromAddress('Cleveland, OH')).toBe('OH');
    expect(stateFromAddress('OH')).toBe('OH');
    expect(stateFromAddress(undefined)).toBeNull();
  });
});

describe('confirm / dismiss', () => {
  it('confirms candidate 0 and sets the time', async () => {
    const { appointment } = (await capture())!;
    const out = await confirm({ store }, appointment, 'owner-1', { candidate: 0 });
    expect(out.status).toBe('confirmed');
    expect(out.startsAt).toBe('2026-11-10T19:30:00.000Z');
  });

  it('answers 409 when confirming twice', async () => {
    const { appointment } = (await capture())!;
    await confirm({ store }, appointment, 'owner-1', { candidate: 0 });
    const again = confirm({ store }, appointment, 'owner-1', { candidate: 0 });
    await expect(again).rejects.toBeInstanceOf(AppointmentError);
    await expect(again).rejects.toMatchObject({ status: 409 });
  });

  it('answers 422 for an unknown candidate', async () => {
    const { appointment } = (await capture())!;
    await expect(confirm({ store }, appointment, 'owner-1', { candidate: 5 })).rejects.toMatchObject({ status: 422, reasons: ['unknown_candidate'] });
  });

  it('answers 422 when the end is not after the start', async () => {
    const { appointment } = (await capture())!;
    await expect(confirm({ store }, appointment, 'owner-1', { startsAt: '2026-11-10T19:30:00.000Z', endsAt: '2026-11-10T19:00:00.000Z' }))
      .rejects.toMatchObject({ status: 422 });
  });

  it('dismisses only proposed appointments', async () => {
    const { appointment } = (await capture())!;
    expect((await dismiss({ store }, appointment)).status).toBe('cancelled');
    await expect(dismiss({ store }, appointment)).rejects.toMatchObject({ status: 409 });
  });

  it('does not dismiss a confirmed appointment', async () => {
    const a = await createManual({ store }, CASE_ID, 'owner-1', { kind: 'appointment', title: 'Visit', startsAt: '2026-11-10T19:30:00.000Z', timezone: 'America/New_York' });
    await expect(dismiss({ store }, a)).rejects.toMatchObject({ status: 409 });
  });
});

describe('sweepReminders', () => {
  const manual = (title: string, startsAt: string) =>
    createManual({ store }, CASE_ID, 'owner-1', { kind: 'appointment', title, startsAt, timezone: 'America/New_York' });

  it('reminds only confirmed appointments within 24h, once', async () => {
    const soon = await manual('soon', '2026-11-10T19:30:00.000Z');
    const later = await manual('later', '2026-11-14T19:30:00.000Z');
    const past = await manual('past', '2026-11-09T10:00:00.000Z');
    const { appointment: proposed } = (await capture())!; // proposed on the same day as `soon`
    const now = new Date('2026-11-10T00:00:00Z');

    expect(await sweepReminders(store, now)).toEqual({ reminded: 1 });
    expect((await store.get(soon.id))!.remindedAt).toBe(now.toISOString());
    expect((await store.get(later.id))!.remindedAt).toBeNull();
    expect((await store.get(past.id))!.remindedAt).toBeNull();
    expect((await store.get(proposed.id))!.remindedAt).toBeNull();

    expect(await sweepReminders(store, now)).toEqual({ reminded: 0 });
  });
});

describe('calendar sync', () => {
  it('upserts on confirm and stores the Google event id', async () => {
    const sync = fakeSync();
    const { appointment } = (await capture())!;
    const out = await confirm({ store, sync }, appointment, 'owner-1', { candidate: 0 });
    expect(sync.upsert).toHaveBeenCalledTimes(1);
    expect(sync.upsert.mock.calls[0][0]).toBe('owner-1');
    expect(out.googleEventId).toBe('evt-1');
    expect((await store.get(appointment.id))!.googleEventId).toBe('evt-1');
  });

  it('removes the Google event when the appointment is cancelled', async () => {
    const sync = fakeSync();
    const { appointment } = (await capture())!;
    const confirmed = await confirm({ store, sync }, appointment, 'owner-1', { candidate: 0 });
    const out = await markCancelled({ store, sync }, confirmed, 'owner-1');
    expect(out.status).toBe('cancelled');
    expect(sync.remove).toHaveBeenCalledTimes(1);
  });

  it('does not call remove when there is no Google event', async () => {
    const sync = fakeSync();
    const { appointment } = (await capture())!;
    await markCancelled({ store, sync }, appointment, 'owner-1');
    expect(sync.remove).not.toHaveBeenCalled();
  });

  it('keeps the confirm when sync throws, and reports the error', async () => {
    const sync = fakeSync();
    sync.upsert.mockRejectedValue(new Error('google down'));
    const onSyncError = vi.fn();
    const { appointment } = (await capture())!;
    const out = await confirm({ store, sync, onSyncError }, appointment, 'owner-1', { candidate: 0 });
    expect(out.status).toBe('confirmed');
    expect(onSyncError).toHaveBeenCalledTimes(1);
    expect((await store.get(appointment.id))!.status).toBe('confirmed');
  });
});
