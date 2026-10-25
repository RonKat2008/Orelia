import type { Appointment } from './schema';

/**
 * Minimal RFC 5545 writer: CRLF line endings, 75-octet folding, TEXT escaping, UTC DATE-TIMEs, VALARM reminders.
 * Event text never includes the diagnosis: calendars sync to third-party services and lock screens.
 */
export const PRODID = '-//Orelia//Appointments 1.0//EN';
const CRLF = '\r\n';

export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 sequence (continuation lines start with a space). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

export function icsDateTime(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function alarmTrigger(minutes: number): string {
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

export interface IcsEventOptions {
  /** Stable host for UIDs. */
  uidDomain: string;
  now: Date;
  /** Prep checklist and links, already plain text. */
  description?: string;
  url?: string;
}

const STATUS: Record<Appointment['status'], string> = {
  proposed: 'TENTATIVE', confirmed: 'CONFIRMED', rescheduled: 'TENTATIVE', cancelled: 'CANCELLED', done: 'CONFIRMED',
};

export function eventLines(appt: Appointment, opts: IcsEventOptions): string[] {
  if (!appt.startsAt) return [];
  const end = appt.endsAt ?? new Date(new Date(appt.startsAt).getTime() + 3600000).toISOString();
  const where = appt.location ?? appt.telehealthUrl ?? undefined;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${appt.id}@${opts.uidDomain}`,
    `DTSTAMP:${icsDateTime(opts.now)}`,
    `DTSTART:${icsDateTime(appt.startsAt)}`,
    `DTEND:${icsDateTime(end)}`,
    `SUMMARY:${escapeText(appt.title)}`,
    ...(where ? [`LOCATION:${escapeText(where)}`] : []),
    ...(opts.description ? [`DESCRIPTION:${escapeText(opts.description)}`] : []),
    ...(opts.url ? [`URL:${opts.url}`] : []),
    `STATUS:${STATUS[appt.status]}`,
    `SEQUENCE:${appt.sequence}`,
    `LAST-MODIFIED:${icsDateTime(appt.updatedAt)}`,
  ];
  if (appt.status !== 'cancelled') {
    for (const minutes of appt.reminders) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(`Reminder: ${appt.title}`)}`, `TRIGGER:${alarmTrigger(minutes)}`, 'END:VALARM');
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar(events: string[][], opts: { name: string; method?: 'PUBLISH' }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${opts.method ?? 'PUBLISH'}`,
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** Tiny RFC 5545 reader for tests and verification: unfolds lines and returns each VEVENT's properties. */
export function parseIcs(text: string): { calendar: Record<string, string>; events: Record<string, string>[]; alarms: number } {
  const unfolded = text.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
  const calendar: Record<string, string> = {};
  const events: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  let depth = 0;
  let alarms = 0;
  for (const line of unfolded) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).split(';')[0];
    const value = line.slice(colon + 1);
    if (name === 'BEGIN') { depth += 1; if (value === 'VEVENT') current = {}; if (value === 'VALARM') alarms += 1; continue; }
    if (name === 'END') { depth -= 1; if (value === 'VEVENT' && current) { events.push(current); current = null; } continue; }
    if (current && depth === 2) current[name] = value;
    else if (!current && depth === 1) calendar[name] = value;
  }
  return { calendar, events, alarms };
}
