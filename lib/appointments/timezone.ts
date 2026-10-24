import { timezoneForHomeState } from '../notify/quiet-hours';

/** Generic US zone words map to IANA so DST is right for the actual date ("ET" in July is EDT). */
const ABBREVIATIONS: Record<string, string> = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York', EASTERN: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago', CENTRAL: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver', MOUNTAIN: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PACIFIC: 'America/Los_Angeles',
  AKT: 'America/Anchorage', AKST: 'America/Anchorage', AKDT: 'America/Anchorage',
  HT: 'Pacific/Honolulu', HST: 'Pacific/Honolulu',
};

/** The zone named right after a time ("2:30pm ET", "10 AM Central time"), if any. */
export function zoneFromText(text: string): string | undefined {
  const m = text.match(/\b(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|AKST|AKDT|AKT|HST|HT|Eastern|Central|Mountain|Pacific)\b/i);
  return m ? ABBREVIATIONS[m[1].toUpperCase()] : undefined;
}

/** Zone for an appointment: explicit in the text, else the resource's state, else the patient's home state. */
export function resolveTimeZone(opts: { text?: string; resourceState?: string | null; homeState?: string | null }): string {
  const explicit = opts.text ? zoneFromText(opts.text) : undefined;
  if (explicit) return explicit;
  if (opts.resourceState?.trim()) return timezoneForHomeState(opts.resourceState);
  return timezoneForHomeState(opts.homeState);
}

function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant) / 60000);
}

/** UTC instant of a wall-clock time in an IANA zone (DST-correct; a skipped hour resolves forward). */
export function wallTimeToUtc(w: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string): Date {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  let instant = guess - offsetMinutes(guess, timeZone) * 60000;
  // Second pass settles the offset when the first guess straddled a DST change.
  instant = guess - offsetMinutes(instant, timeZone) * 60000;
  return new Date(instant);
}

/** Wall-clock parts of an instant in a zone. */
export function zonedParts(instant: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short',
  }).formatToParts(instant);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), hour: Number(get('hour')), minute: Number(get('minute')), weekday };
}

/** "Tue, Nov 10, 2:30 PM EST" in the appointment's zone. */
export function formatInZone(instant: string | Date, timeZone: string, opts: { withZone?: boolean } = {}): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(opts.withZone === false ? {} : { timeZoneName: 'short' }),
  }).format(new Date(instant));
}
