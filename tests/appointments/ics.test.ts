import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, eventLines, foldLine, icsDateTime, parseIcs, PRODID } from '@/lib/appointments/ics';
import { eventDescription } from '@/lib/appointments/prep';
import { feedIcs, singleEventIcs } from '@/lib/appointments/service';
import { makeAppointment } from './fixtures';

const now = new Date('2026-10-25T12:00:00Z');
const opts = { now, uidDomain: 'wayfinder.test' };
const octets = (s: string) => Buffer.byteLength(s, 'utf8');

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines per RFC 5545', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
});

describe('foldLine', () => {
  it('leaves a short line untouched', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('never produces a physical line over 75 octets, even with multi-byte characters', () => {
    const line = `SUMMARY:${'é漢字😀'.repeat(60)}`;
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const p of physical) expect(octets(p)).toBeLessThanOrEqual(75);
    for (const p of physical.slice(1)) expect(p.startsWith(' ')).toBe(true);
  });

  it('unfolds back to the original line without splitting a UTF-8 sequence', () => {
    const line = `DESCRIPTION:${'日本語😀'.repeat(40)}`;
    const unfolded = foldLine(line).replace(/\r\n /g, '');
    expect(unfolded).toBe(line);
    expect(unfolded).not.toContain('�');
  });
});

describe('icsDateTime', () => {
  it('formats UTC as YYYYMMDDTHHMMSSZ', () => {
    expect(icsDateTime('2026-11-10T19:30:00.000Z')).toBe('20261110T193000Z');
  });
});

describe('buildCalendar / eventLines', () => {
  const ics = singleEventIcs(makeAppointment(), opts);

  it('uses CRLF everywhere and ends with CRLF', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every line within 75 octets, including long multi-byte titles', () => {
    const long = singleEventIcs(makeAppointment({ title: `Visite médicale ${'日本語, 😀; '.repeat(30)}`, location: 'Zürich, Rämistrasse 100; '.repeat(8) }), opts);
    for (const line of long.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
  });

  it('carries the required calendar and event properties', () => {
    const p = parseIcs(ics);
    expect(p.calendar.VERSION).toBe('2.0');
    expect(p.calendar.PRODID).toBe(PRODID);
    const ev = p.events[0];
    expect(ev.UID).toBe('22222222-2222-4222-8222-222222222222@wayfinder.test');
    expect(ev.DTSTAMP).toBe('20261025T120000Z');
    expect(ev.DTSTART).toMatch(/^\d{8}T\d{6}Z$/);
    expect(ev.DTEND).toMatch(/^\d{8}T\d{6}Z$/);
    expect(ev.DTSTART).toBe('20261110T193000Z');
    expect(ev.DTEND).toBe('20261110T203000Z');
    expect(ev.STATUS).toBe('CONFIRMED');
  });

  it('balances BEGIN and END lines', () => {
    const lines = ics.split('\r\n').filter(Boolean);
    const stack: string[] = [];
    for (const l of lines) {
      if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
      if (l.startsWith('END:')) expect(stack.pop()).toBe(l.slice(4));
    }
    expect(stack).toEqual([]);
  });

  it('writes two VALARMs with -P1D and -PT2H for the default reminders', () => {
    expect(parseIcs(ics).alarms).toBe(2);
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('TRIGGER:-PT2H');
  });

  it('marks a cancelled event STATUS:CANCELLED with no VALARM', () => {
    const cancelled = singleEventIcs(makeAppointment({ status: 'cancelled' }), opts);
    expect(cancelled).toContain('STATUS:CANCELLED');
    expect(cancelled).not.toContain('BEGIN:VALARM');
  });

  it('emits no event for an appointment without a time', () => {
    expect(eventLines(makeAppointment({ startsAt: null }), opts)).toEqual([]);
  });

  it('defaults the end to one hour after the start', () => {
    const ev = parseIcs(singleEventIcs(makeAppointment({ endsAt: null }), opts)).events[0];
    expect(ev.DTEND).toBe('20261110T203000Z');
  });

  it('never includes a diagnosis in the title or description', () => {
    const appt = makeAppointment({ prepNotes: { checked: {}, questions: ['What are my options?'], note: '' } });
    const description = eventDescription(appt);
    const all = singleEventIcs(appt, opts);
    for (const text of [appt.title, description, all]) expect(text.toLowerCase()).not.toContain('sarcoma');
    expect(description).toContain('Not medical advice');
  });

  it('round-trips through parseIcs with escaped text intact', () => {
    const appt = makeAppointment({ title: 'Consult, with; Dr. Lee', location: '9500 Euclid Ave, Cleveland' });
    const ev = parseIcs(buildCalendar([eventLines(appt, opts)], { name: 'X' })).events[0];
    expect(ev.SUMMARY).toBe(escapeText(appt.title));
    expect(ev.LOCATION).toBe(escapeText(appt.location!));
    expect(ev.SEQUENCE).toBe('0');
  });
});

describe('feedIcs', () => {
  it('excludes proposed appointments and includes confirmed ones', () => {
    const confirmed = makeAppointment({ id: '33333333-3333-4333-8333-333333333333' });
    const proposed = makeAppointment({ id: '44444444-4444-4444-8444-444444444444', status: 'proposed' });
    const parsed = parseIcs(feedIcs([confirmed, proposed], opts));
    expect(parsed.events.map(e => e.UID)).toEqual(['33333333-3333-4333-8333-333333333333@wayfinder.test']);
  });
});
