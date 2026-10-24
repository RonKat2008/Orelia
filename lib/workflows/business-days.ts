import { isUsFederalHoliday } from './holidays';

export const DEFAULT_TZ = 'America/New_York';

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

function localParts(date: Date, tz: string): LocalParts {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid Date');
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** Milliseconds of the instant's local wall clock expressed as if it were UTC. */
function wallAsUtc(p: LocalParts, ms: number): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, ms);
}

function msPart(date: Date): number {
  return ((date.getTime() % 1000) + 1000) % 1000;
}

/** tz offset (local - UTC, in ms) at the given instant. */
function offsetAt(instant: number, tz: string): number {
  const ms = ((instant % 1000) + 1000) % 1000;
  return wallAsUtc(localParts(new Date(instant), tz), ms) - instant;
}

/** Convert a wall-clock (expressed as UTC ms) in tz to an instant, DST-aware. */
function wallToInstant(wall: number, tz: string): number {
  const off1 = offsetAt(wall, tz);
  let t = wall - off1;
  const off2 = offsetAt(t, tz);
  if (off2 !== off1) t = wall - off2;
  return t;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function isBusinessYmd(utcDayMs: number): boolean {
  const d = new Date(utcDayMs);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isUsFederalHoliday(ymdOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
}

const DAY_MS = 86_400_000;

/** Local calendar date of an instant as UTC-midnight ms (a calendar-day key). */
function localDayKey(date: Date, tz: string): number {
  const p = localParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day);
}

export function isBusinessDay(date: Date, tz: string = DEFAULT_TZ): boolean {
  return isBusinessYmd(localDayKey(date, tz));
}

export function addBusinessDays(date: Date, n: number, tz: string = DEFAULT_TZ): Date {
  if (!Number.isInteger(n)) throw new RangeError(`n must be an integer, got ${n}`);
  if (n === 0) return new Date(date.getTime());
  const p = localParts(date, tz);
  const step = n > 0 ? 1 : -1;
  let day = Date.UTC(p.year, p.month - 1, p.day);
  let remaining = Math.abs(n);
  while (remaining > 0) {
    day += step * DAY_MS;
    if (isBusinessYmd(day)) remaining--;
  }
  const target = new Date(day);
  const wall = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
    p.hour,
    p.minute,
    p.second,
    msPart(date),
  );
  return new Date(wallToInstant(wall, tz));
}

/** Business local-dates d with start < d <= end; negative when end < start. */
export function businessDaysBetween(start: Date, end: Date, tz: string = DEFAULT_TZ): number {
  const a = localDayKey(start, tz);
  const b = localDayKey(end, tz);
  if (a === b) return 0;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let count = 0;
  for (let d = lo + DAY_MS; d <= hi; d += DAY_MS) {
    if (isBusinessYmd(d)) count++;
  }
  return b > a ? count : 0 - count;
}
