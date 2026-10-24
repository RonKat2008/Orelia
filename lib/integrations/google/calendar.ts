import type { Appointment } from '../../appointments/schema';
import { wallTimeToUtc, zonedParts, formatInZone } from '../../appointments/timezone';

/** Google Calendar REST calls (events + freeBusy) with an access token. Network goes through the injected fetcher. */
const API = 'https://www.googleapis.com/calendar/v3';

export interface EventPayload {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  status: 'confirmed' | 'cancelled' | 'tentative';
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
  extendedProperties: { private: { wayfinderAppointmentId: string } };
}

export function eventPayload(appt: Appointment, description: string): EventPayload {
  if (!appt.startsAt) throw new Error('Appointment has no time');
  const end = appt.endsAt ?? new Date(new Date(appt.startsAt).getTime() + 3600000).toISOString();
  return {
    summary: appt.title,
    ...(appt.location ?? appt.telehealthUrl ? { location: (appt.location ?? appt.telehealthUrl)! } : {}),
    description,
    start: { dateTime: appt.startsAt, timeZone: appt.timezone },
    end: { dateTime: end, timeZone: appt.timezone },
    status: appt.status === 'cancelled' ? 'cancelled' : 'confirmed',
    // Google allows at most 5 overrides, each at most 4 weeks.
    reminders: { useDefault: false, overrides: appt.reminders.slice(0, 5).filter(m => m <= 40320).map(minutes => ({ method: 'popup' as const, minutes })) },
    extendedProperties: { private: { wayfinderAppointmentId: appt.id } },
  };
}

export class GoogleApiError extends Error {
  constructor(readonly status: number) { super(`Google Calendar API returned ${status}`); this.name = 'GoogleApiError'; }
}

async function call(fetcher: typeof fetch, token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetcher(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204 || res.status === 410) return null;
  if (!res.ok) throw new GoogleApiError(res.status);
  return res.json();
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}`;

export async function insertEvent(fetcher: typeof fetch, token: string, calendarId: string, payload: EventPayload): Promise<string> {
  const out = (await call(fetcher, token, 'POST', `${cal(calendarId)}/events`, payload)) as { id?: unknown } | null;
  if (!out || typeof out.id !== 'string') throw new Error('Google did not return an event id');
  return out.id;
}

export async function patchEvent(fetcher: typeof fetch, token: string, calendarId: string, eventId: string, payload: EventPayload): Promise<void> {
  await call(fetcher, token, 'PATCH', `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, payload);
}

export async function deleteEvent(fetcher: typeof fetch, token: string, calendarId: string, eventId: string): Promise<void> {
  try { await call(fetcher, token, 'DELETE', `${cal(calendarId)}/events/${encodeURIComponent(eventId)}`); }
  catch (e) { if (!(e instanceof GoogleApiError && e.status === 404)) throw e; }
}

export interface Busy { start: string; end: string }

export async function freeBusy(fetcher: typeof fetch, token: string, calendarId: string, timeMin: Date, timeMax: Date): Promise<Busy[]> {
  const out = (await call(fetcher, token, 'POST', '/freeBusy', { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: calendarId }] })) as { calendars?: Record<string, { busy?: Busy[] }> } | null;
  const busy = out?.calendars?.[calendarId]?.busy ?? [];
  return busy.filter(b => typeof b.start === 'string' && typeof b.end === 'string');
}

/**
 * Up to `count` one-hour weekday slots between 9:00 and 17:00 in `timeZone` that overlap no busy interval, starting
 * the next business day. Pure: used to suggest times in a drafted reschedule request.
 */
export function suggestFreeSlots(busy: Busy[], from: Date, timeZone: string, opts: { days?: number; count?: number } = {}): string[] {
  const out: string[] = [];
  const intervals = busy.map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const startDay = zonedParts(from, timeZone);
  for (let d = 1; d <= (opts.days ?? 14) && out.length < (opts.count ?? 3); d++) {
    const noon = wallTimeToUtc({ year: startDay.year, month: startDay.month, day: startDay.day + d, hour: 12, minute: 0 }, timeZone);
    const day = zonedParts(noon, timeZone);
    if (day.weekday === 0 || day.weekday === 6) continue;
    for (const hour of [9, 10, 11, 13, 14, 15, 16]) {
      const start = wallTimeToUtc({ year: day.year, month: day.month, day: day.day, hour, minute: 0 }, timeZone).getTime();
      const end = start + 3600000;
      if (intervals.some(([a, b]) => a < end && b > start)) continue;
      out.push(formatInZone(new Date(start), timeZone));
      break; // one suggestion per day keeps the list varied
    }
  }
  return out;
}
