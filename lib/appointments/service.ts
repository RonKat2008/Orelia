import type { CalendarSync } from '../integrations/google/connection';
import { buildCalendar, eventLines } from './ics';
import { eventDescription } from './prep';
import { DEFAULT_REMINDERS, type Appointment, type AppointmentInput, type ConfirmInput, type PrepNotes } from './schema';
import type { AppointmentStore } from './store';

/** Appointment operations. Routes authorize (case ownership) before calling any of these. */
export class AppointmentError extends Error {
  constructor(readonly status: number, readonly reasons: string[]) { super(reasons.join(', ')); this.name = 'AppointmentError'; }
}

export interface ServiceDeps {
  store: AppointmentStore;
  sync?: CalendarSync;
  /** Absolute app origin for links in event descriptions. */
  appOrigin?: string;
  onSyncError?: (err: unknown) => void;
}

const appUrl = (deps: ServiceDeps, a: Appointment) => (deps.appOrigin ? `${deps.appOrigin}/cases/${a.caseId}/appointments` : undefined);

/** Calendar sync is best-effort: a Google outage never blocks the patient's own record. */
async function syncUpsert(deps: ServiceDeps, ownerKey: string | null, a: Appointment): Promise<Appointment> {
  if (!deps.sync || !ownerKey || !a.startsAt) return a;
  try {
    const eventId = await deps.sync.upsert(ownerKey, a, appUrl(deps, a));
    if (eventId && eventId !== a.googleEventId) return (await deps.store.update(a.id, { googleEventId: eventId })) ?? a;
  } catch (err) { (deps.onSyncError ?? (e => console.error('Calendar sync failed:', e instanceof Error ? e.name : 'unknown')))(err); }
  return a;
}

async function syncRemove(deps: ServiceDeps, ownerKey: string | null, a: Appointment): Promise<void> {
  if (!deps.sync || !ownerKey || !a.googleEventId) return;
  try { await deps.sync.remove(ownerKey, a); } catch (err) { (deps.onSyncError ?? (() => undefined))(err); }
}

export async function createManual(deps: ServiceDeps, caseId: string, ownerKey: string | null, input: AppointmentInput): Promise<Appointment> {
  const end = input.endsAt ?? new Date(new Date(input.startsAt).getTime() + 3600000).toISOString();
  const { appointment } = await deps.store.insert({
    caseId, ownerKey, contactId: input.contactId ?? null, kind: input.kind, title: input.title, startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(end).toISOString(),
    timezone: input.timezone, location: input.location || null, telehealthUrl: input.telehealthUrl ?? null, phone: input.phone || null,
    withWhom: input.withWhom || null, status: 'confirmed', source: 'manual', sourceMessageId: null, candidates: [], quote: null,
    prepNotes: { checked: {}, questions: [], note: '' }, reminders: [...DEFAULT_REMINDERS],
  });
  return syncUpsert(deps, ownerKey, appointment);
}

/** The patient confirms a proposed time (one of the candidates, or a corrected time). Only proposed rows confirm. */
export async function confirm(deps: ServiceDeps, appt: Appointment, ownerKey: string | null, input: ConfirmInput): Promise<Appointment> {
  if (appt.status !== 'proposed' && appt.status !== 'rescheduled') throw new AppointmentError(409, ['not_proposed']);
  let startsAt = input.startsAt ? new Date(input.startsAt).toISOString() : undefined;
  let endsAt = input.endsAt ? new Date(input.endsAt).toISOString() : undefined;
  if (input.candidate !== undefined) {
    const slot = appt.candidates[input.candidate];
    if (!slot) throw new AppointmentError(422, ['unknown_candidate']);
    startsAt = slot.startsAt;
    endsAt = slot.endsAt;
  }
  if (!startsAt) throw new AppointmentError(422, ['time_required']);
  endsAt ??= new Date(new Date(startsAt).getTime() + 3600000).toISOString();
  if (new Date(endsAt) <= new Date(startsAt)) throw new AppointmentError(422, ['end_before_start']);
  const updated = await deps.store.update(appt.id, {
    status: 'confirmed', startsAt, endsAt,
    ...(input.kind ? { kind: input.kind } : {}), ...(input.title ? { title: input.title } : {}),
    ...(input.location !== undefined ? { location: input.location || null } : {}),
    ...(input.telehealthUrl !== undefined ? { telehealthUrl: input.telehealthUrl } : {}),
    ...(input.timezone ? { timezone: input.timezone } : {}),
  }, ['proposed', 'rescheduled']);
  if (!updated) throw new AppointmentError(409, ['not_proposed']);
  return syncUpsert(deps, ownerKey, updated);
}

/** Not this one: a proposed time the patient does not want is dismissed (cancelled; nothing is sent). */
export async function dismiss(deps: ServiceDeps, appt: Appointment): Promise<Appointment> {
  const updated = await deps.store.update(appt.id, { status: 'cancelled' }, ['proposed']);
  if (!updated) throw new AppointmentError(409, ['not_proposed']);
  return updated;
}

export async function updatePrep(deps: ServiceDeps, appt: Appointment, ownerKey: string | null, prep: PrepNotes): Promise<Appointment> {
  const updated = await deps.store.update(appt.id, { prepNotes: prep });
  if (!updated) throw new AppointmentError(404, ['not_found']);
  return updated.status === 'confirmed' ? syncUpsert(deps, ownerKey, updated) : updated;
}

export async function markDone(deps: ServiceDeps, appt: Appointment): Promise<Appointment> {
  const updated = await deps.store.update(appt.id, { status: 'done' }, ['confirmed']);
  if (!updated) throw new AppointmentError(409, ['not_confirmed']);
  return updated;
}

/** After a cancel request is sent (or the patient records a cancellation): cancelled, and the Google event removed. */
export async function markCancelled(deps: ServiceDeps, appt: Appointment, ownerKey: string | null): Promise<Appointment> {
  const updated = await deps.store.update(appt.id, { status: 'cancelled' }, ['confirmed', 'rescheduled', 'proposed']);
  if (!updated) throw new AppointmentError(409, ['not_active']);
  await syncRemove(deps, ownerKey, updated);
  return updated;
}

export async function markRescheduling(deps: ServiceDeps, appt: Appointment, ownerKey: string | null): Promise<Appointment> {
  const updated = await deps.store.update(appt.id, { status: 'rescheduled' }, ['confirmed']);
  if (!updated) throw new AppointmentError(409, ['not_confirmed']);
  await syncRemove(deps, ownerKey, updated);
  return (await deps.store.update(updated.id, { googleEventId: null })) ?? updated;
}

/** Appointments worth showing on a calendar: confirmed or done, with a time. */
export function calendarWorthy(a: Appointment): boolean {
  return !!a.startsAt && (a.status === 'confirmed' || a.status === 'done' || a.status === 'cancelled');
}

export function singleEventIcs(a: Appointment, opts: { now: Date; uidDomain: string; appOrigin?: string }): string {
  const url = opts.appOrigin ? `${opts.appOrigin}/cases/${a.caseId}/appointments` : undefined;
  return buildCalendar([eventLines(a, { now: opts.now, uidDomain: opts.uidDomain, description: eventDescription(a, url ? { appUrl: url } : {}), ...(url ? { url } : {}) })], { name: 'Wayfinder appointment' });
}

export function feedIcs(appts: Appointment[], opts: { now: Date; uidDomain: string; appOrigin?: string }): string {
  const events = appts.filter(calendarWorthy).map(a => {
    const url = opts.appOrigin ? `${opts.appOrigin}/cases/${a.caseId}/appointments` : undefined;
    return eventLines(a, { now: opts.now, uidDomain: opts.uidDomain, description: eventDescription(a, url ? { appUrl: url } : {}), ...(url ? { url } : {}) });
  });
  return buildCalendar(events, { name: 'Wayfinder appointments' });
}

export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly cron: confirmed appointments starting within the next day get an in-app reminder (reminded_at). No email
 * or SMS goes to the patient from here.
 */
export async function sweepReminders(store: AppointmentStore, now: Date = new Date()): Promise<{ reminded: number }> {
  const due = await store.dueReminders(now, REMINDER_WINDOW_MS);
  let reminded = 0;
  for (const a of due) {
    if (await store.update(a.id, { remindedAt: now.toISOString() }, ['confirmed'])) reminded += 1;
  }
  return { reminded };
}
