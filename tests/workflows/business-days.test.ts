import { describe, expect, it } from 'vitest';
import { US_FEDERAL_HOLIDAYS, isUsFederalHoliday } from '../../lib/workflows/holidays';
import {
  DEFAULT_TZ,
  addBusinessDays,
  businessDaysBetween,
  isBusinessDay,
} from '../../lib/workflows/business-days';

// ---- rule-derived holiday calendar (independent of the hard-coded list) ----
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = dow(y, m, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDay - ((dow(y, m, lastDay) - weekday + 7) % 7);
}
function observed(y: number, m: number, d: number): string {
  const w = dow(y, m, d);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (w === 6) t.setUTCDate(t.getUTCDate() - 1);
  else if (w === 0) t.setUTCDate(t.getUTCDate() + 1);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function derive(y: number): { date: string; name: string }[] {
  return [
    { date: observed(y, 1, 1), name: "New Year's Day" },
    { date: ymd(y, 1, nthWeekday(y, 1, 1, 3)), name: 'Birthday of Martin Luther King, Jr.' },
    { date: ymd(y, 2, nthWeekday(y, 2, 1, 3)), name: "Washington's Birthday" },
    { date: ymd(y, 5, lastWeekday(y, 5, 1)), name: 'Memorial Day' },
    { date: observed(y, 6, 19), name: 'Juneteenth National Independence Day' },
    { date: observed(y, 7, 4), name: 'Independence Day' },
    { date: ymd(y, 9, nthWeekday(y, 9, 1, 1)), name: 'Labor Day' },
    { date: ymd(y, 10, nthWeekday(y, 10, 1, 2)), name: 'Columbus Day' },
    { date: observed(y, 11, 11), name: 'Veterans Day' },
    { date: ymd(y, 11, nthWeekday(y, 11, 4, 4)), name: 'Thanksgiving Day' },
    { date: observed(y, 12, 25), name: 'Christmas Day' },
  ];
}

describe('holidays', () => {
  it('hard-coded list matches the rule-derived dates for 2025-2028', () => {
    const expected = [2025, 2026, 2027, 2028, 2029]
      .flatMap(derive)
      .filter((h) => h.date >= '2025-01-01' && h.date <= '2028-12-31')
      .map((h) => h.date)
      .sort();
    const actual = US_FEDERAL_HOLIDAYS.map((h) => h.date).sort();
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('has names and known spot checks', () => {
    for (const h of US_FEDERAL_HOLIDAYS) expect(h.name.length).toBeGreaterThan(0);
    expect(isUsFederalHoliday('2025-01-20')).toBe(true); // MLK
    expect(isUsFederalHoliday('2026-07-03')).toBe(true); // July 4 observed
    expect(isUsFederalHoliday('2026-07-04')).toBe(false);
    expect(isUsFederalHoliday('2027-12-24')).toBe(true);
    expect(isUsFederalHoliday('2027-12-31')).toBe(true);
    expect(isUsFederalHoliday('2028-11-10')).toBe(true);
    expect(isUsFederalHoliday('2026-11-26')).toBe(true);
    expect(isUsFederalHoliday('2026-11-27')).toBe(false);
  });
});

// Helper: instant for a wall-clock time in America/New_York given explicit UTC offset.
const utc = (s: string) => new Date(s);

describe('isBusinessDay', () => {
  it('weekdays yes, weekends no', () => {
    expect(DEFAULT_TZ).toBe('America/New_York');
    expect(isBusinessDay(utc('2026-11-06T15:00:00Z'))).toBe(true); // Fri
    expect(isBusinessDay(utc('2026-11-07T15:00:00Z'))).toBe(false); // Sat
    expect(isBusinessDay(utc('2026-11-08T15:00:00Z'))).toBe(false); // Sun
  });
  it('holidays no', () => {
    expect(isBusinessDay(utc('2026-11-26T15:00:00Z'))).toBe(false);
    expect(isBusinessDay(utc('2026-07-03T15:00:00Z'))).toBe(false);
  });
  it('uses the local date in the tz', () => {
    // 2026-11-27 02:00Z is Thu 2026-11-26 21:00 in New York (Thanksgiving)
    expect(isBusinessDay(utc('2026-11-27T02:00:00Z'))).toBe(false);
    expect(isBusinessDay(utc('2026-11-27T02:00:00Z'), 'Asia/Tokyo')).toBe(true); // Fri 11:00 Tokyo
    // Fri 2026-11-06 23:30 NY = Sat 04:30Z -> still a business day
    expect(isBusinessDay(utc('2026-11-07T04:30:00Z'))).toBe(true);
  });
});

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // Fri 2026-11-13 10:00 EST = 15:00Z
    const fri = utc('2026-11-13T15:00:00Z');
    expect(addBusinessDays(fri, 1).toISOString()).toBe('2026-11-16T15:00:00.000Z');
    expect(addBusinessDays(fri, 3).toISOString()).toBe('2026-11-18T15:00:00.000Z');
    expect(addBusinessDays(fri, 5).toISOString()).toBe('2026-11-20T15:00:00.000Z');
  });
  it('n = 0 returns same instant', () => {
    const d = utc('2026-11-07T15:00:00Z');
    expect(addBusinessDays(d, 0).getTime()).toBe(d.getTime());
  });
  it('starting on a weekend', () => {
    // Sat 2026-11-07 + 1 = Mon 11-09
    expect(addBusinessDays(utc('2026-11-07T15:00:00Z'), 1).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });
  it('skips holidays (Thanksgiving)', () => {
    // Thu 2026-11-25 10:00 EST + 1 = Fri 11-27
    expect(addBusinessDays(utc('2026-11-25T15:00:00Z'), 1).toISOString()).toBe('2026-11-27T15:00:00.000Z');
  });
  it('skips observed July 4', () => {
    // Fri 2026-07-02 10:00 EDT = 14:00Z; 07-03 observed -> Mon 07-06
    expect(addBusinessDays(utc('2026-07-02T14:00:00Z'), 1).toISOString()).toBe('2026-07-06T14:00:00.000Z');
  });
  it('Saturday + 1 lands on Tuesday when Monday is a holiday', () => {
    // Sat 2026-05-23, Memorial Day Mon 2026-05-25 -> Tue 05-26
    expect(addBusinessDays(utc('2026-05-23T14:00:00Z'), 1).toISOString()).toBe('2026-05-26T14:00:00.000Z');
  });
  it('year boundary', () => {
    // Thu 2026-12-31 10:00 EST; 2027-01-01 holiday, weekend -> Mon 2027-01-04
    expect(addBusinessDays(utc('2026-12-31T15:00:00Z'), 1).toISOString()).toBe('2027-01-04T15:00:00.000Z');
  });
  it('negative n steps backwards', () => {
    expect(addBusinessDays(utc('2026-11-16T15:00:00Z'), -1).toISOString()).toBe('2026-11-13T15:00:00.000Z');
    expect(addBusinessDays(utc('2026-11-27T15:00:00Z'), -1).toISOString()).toBe('2026-11-25T15:00:00.000Z');
  });
  it('keeps local wall-clock time across the DST fall-back boundary', () => {
    // Fri 2026-11-06 10:00 EST? DST ends Sun 2026-11-01 -> use a start before that.
    // Fri 2026-10-30 10:00 EDT = 14:00Z; +1 business day = Mon 2026-11-02 10:00 EST = 15:00Z
    expect(addBusinessDays(utc('2026-10-30T14:00:00Z'), 1).toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });
  it('keeps local wall-clock time across the spring-forward boundary', () => {
    // DST begins Sun 2026-03-08. Fri 03-06 10:00 EST = 15:00Z; Mon 03-09 10:00 EDT = 14:00Z
    expect(addBusinessDays(utc('2026-03-06T15:00:00Z'), 1).toISOString()).toBe('2026-03-09T14:00:00.000Z');
  });
  it('Nov 6 2026 10:00 NY + 1 = Nov 9 10:00 NY (same offset, EST)', () => {
    expect(addBusinessDays(utc('2026-11-06T15:00:00Z'), 1).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });
  it('late-night UTC instants use the previous New York date', () => {
    // 2026-11-10T03:00Z = Mon 2026-11-09 22:00 EST -> +1 = Tue 11-10 22:00 EST = 11-11T03:00Z
    expect(addBusinessDays(utc('2026-11-10T03:00:00Z'), 1).toISOString()).toBe('2026-11-11T03:00:00.000Z');
    // 2026-11-14T03:00Z = Fri 2026-11-13 22:00 EST -> +1 = Mon 11-16 22:00 EST
    expect(addBusinessDays(utc('2026-11-14T03:00:00Z'), 1).toISOString()).toBe('2026-11-17T03:00:00.000Z');
  });
  it('non-default tz (Los Angeles) where local date differs from New York', () => {
    const LA = 'America/Los_Angeles';
    // 2026-11-14T06:00Z = Fri 11-13 22:00 PST = Sat 11-14 01:00 EST
    const d = utc('2026-11-14T06:00:00Z');
    expect(isBusinessDay(d, LA)).toBe(true);
    expect(isBusinessDay(d, 'America/New_York')).toBe(false);
    // LA: Fri + 1 = Mon 11-16 22:00 PST = 11-17T06:00Z
    expect(addBusinessDays(d, 1, LA).toISOString()).toBe('2026-11-17T06:00:00.000Z');
    // NY: Sat 01:00 EST + 1 = Mon 11-16 01:00 EST = 06:00Z
    expect(addBusinessDays(d, 1, 'America/New_York').toISOString()).toBe('2026-11-16T06:00:00.000Z');
  });
  it('throws on non-integer n', () => {
    expect(() => addBusinessDays(new Date(), 1.5)).toThrow();
    expect(() => addBusinessDays(new Date(), Number.NaN)).toThrow();
  });
});

describe('businessDaysBetween', () => {
  it('same local date is 0', () => {
    expect(businessDaysBetween(utc('2026-11-09T14:00:00Z'), utc('2026-11-10T03:00:00Z'))).toBe(0);
  });
  it('counts (start, end] local dates', () => {
    expect(businessDaysBetween(utc('2026-11-13T15:00:00Z'), utc('2026-11-16T15:00:00Z'))).toBe(1);
    expect(businessDaysBetween(utc('2026-11-13T15:00:00Z'), utc('2026-11-20T15:00:00Z'))).toBe(5);
  });
  it('excludes holidays and weekends', () => {
    // Wed 11-25 -> Mon 11-30: Fri 27, Mon 30 = 2
    expect(businessDaysBetween(utc('2026-11-25T15:00:00Z'), utc('2026-11-30T15:00:00Z'))).toBe(2);
  });
  it('negative when end < start', () => {
    expect(businessDaysBetween(utc('2026-11-20T15:00:00Z'), utc('2026-11-13T15:00:00Z'))).toBe(-5);
  });
  it('respects tz for local dates', () => {
    // Fri 22:00 PST vs Sat 01:00 EST same instant
    const a = utc('2026-11-13T05:00:00Z'); // Thu 11-12 20:00 PST
    const b = utc('2026-11-14T06:00:00Z'); // Fri 11-13 22:00 PST
    expect(businessDaysBetween(a, b, 'America/Los_Angeles')).toBe(1);
    expect(businessDaysBetween(a, b, 'America/New_York')).toBe(0); // Fri 00:00 -> Sat 01:00: Saturday is not a business day
  });
  it('round-trips with addBusinessDays for business-day starts', () => {
    const starts = [
      '2026-03-06T15:00:00Z',
      '2026-10-30T14:00:00Z',
      '2026-11-24T15:00:00Z',
      '2026-12-30T15:00:00Z',
      '2027-12-23T15:00:00Z',
    ];
    for (const s of starts) {
      const d = utc(s);
      for (let n = 0; n <= 15; n++) {
        expect(businessDaysBetween(d, addBusinessDays(d, n))).toBe(n);
        expect(businessDaysBetween(d, addBusinessDays(d, -n))).toBe(0 - n);
      }
    }
  });
});
