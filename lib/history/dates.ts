/**
 * Date finding for messy medical records. Understands 2019-03-04, 03/04/2019 (US month first unless the first
 * number can only be a day), "March 4, 2019", "4 March 2019", "Mar 2019" and (optionally) a bare year.
 * Output is an ISO date at the precision the text gave: YYYY, YYYY-MM or YYYY-MM-DD.
 */

export interface FoundDate { iso: string; index: number; length: number }

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH = '(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?';
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

const DATE_RE = new RegExp([
  '(?<iso>\\b(?<iy>\\d{4})[-/.](?<im>\\d{1,2})[-/.](?<id>\\d{1,2})\\b)',
  `(?<mdy>\\b(?<mdyM>${MONTH})\\s+(?<mdyD>\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?<mdyY>\\d{4})\\b)`,
  `(?<dmy>\\b(?<dmyD>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<dmyM>${MONTH}),?\\s+(?<dmyY>\\d{4})\\b)`,
  `(?<my>\\b(?<myM>${MONTH}),?\\s+(?<myY>\\d{4})\\b)`,
  '(?<us>\\b(?<usA>\\d{1,2})[/.-](?<usB>\\d{1,2})[/.-](?<usY>\\d{4})\\b)',
  '(?<yr>\\b(?:19|20)\\d{2}\\b)',
].join('|'), 'gi');

const pad = (n: number): string => String(n).padStart(2, '0');
const validYear = (y: number): boolean => y >= MIN_YEAR && y <= MAX_YEAR;
const validMonth = (m: number): boolean => m >= 1 && m <= 12;
const validDay = (d: number): boolean => d >= 1 && d <= 31;

function monthNumber(name: string): number | undefined {
  return MONTHS[name.toLowerCase().replace(/\.$/, '')];
}

function ymd(y: number, m: number, d: number): string | null {
  return validYear(y) && validMonth(m) && validDay(d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

function isoFor(g: Record<string, string | undefined>, allowBareYear: boolean): string | null {
  if (g.iso) return ymd(Number(g.iy), Number(g.im), Number(g.id));
  if (g.mdy) { const m = monthNumber(g.mdyM!); return m ? ymd(Number(g.mdyY), m, Number(g.mdyD)) : null; }
  if (g.dmy) { const m = monthNumber(g.dmyM!); return m ? ymd(Number(g.dmyY), m, Number(g.dmyD)) : null; }
  if (g.my) {
    const m = monthNumber(g.myM!); const y = Number(g.myY);
    return m && validYear(y) ? `${y}-${pad(m)}` : null;
  }
  if (g.us) {
    const a = Number(g.usA); const b = Number(g.usB);
    // 13/02/2019 can only be day-first; otherwise follow the US convention.
    return a > 12 && b <= 12 ? ymd(Number(g.usY), b, a) : ymd(Number(g.usY), a, b);
  }
  if (g.yr && allowBareYear) { const y = Number(g.yr); return validYear(y) ? String(y) : null; }
  return null;
}

/** All dates in `text`, left to right. A bare 4-digit year counts only when `bareYear` is set. */
export function findDates(text: string, opts: { bareYear?: boolean } = {}): FoundDate[] {
  const out: FoundDate[] = [];
  for (const match of text.matchAll(DATE_RE)) {
    const iso = isoFor(match.groups ?? {}, opts.bareYear === true);
    if (iso) out.push({ iso, index: match.index ?? 0, length: match[0].length });
  }
  return out;
}

/** Sortable key: partial dates sort before the more precise dates inside them. Undated -> undefined. */
export function dateSortKey(date: string | null): string | undefined {
  if (!date) return undefined;
  return date.length === 4 ? `${date}-00-00` : date.length === 7 ? `${date}-00` : date;
}
