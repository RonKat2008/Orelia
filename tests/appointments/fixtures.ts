import type { Appointment } from '@/lib/appointments/schema';

export const CASE_ID = '11111111-1111-4111-8111-111111111111';

/** A confirmed in-person appointment; override any field. */
export function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    caseId: CASE_ID,
    ownerKey: 'owner-1',
    contactId: null,
    kind: 'appointment',
    title: 'Appointment with Cleveland Clinic',
    startsAt: '2026-11-10T19:30:00.000Z',
    endsAt: '2026-11-10T20:30:00.000Z',
    timezone: 'America/New_York',
    location: '9500 Euclid Ave',
    telehealthUrl: null,
    phone: null,
    withWhom: 'Cleveland Clinic',
    status: 'confirmed',
    source: 'manual',
    sourceMessageId: null,
    candidates: [],
    quote: null,
    prepNotes: { checked: {}, questions: [], note: '' },
    reminders: [1440, 120],
    remindedAt: null,
    googleEventId: null,
    requestMessageId: null,
    sequence: 0,
    createdAt: '2026-10-24T19:00:00.000Z',
    updatedAt: '2026-10-24T19:00:00.000Z',
    ...overrides,
  };
}
