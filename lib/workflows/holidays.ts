/** Source: US Office of Personnel Management federal holiday schedule. */
export const US_FEDERAL_HOLIDAYS_SOURCE_URL =
  'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/';

/**
 * US federal holidays 2025-2028 as OBSERVED dates (Saturday holiday -> preceding
 * Friday, Sunday holiday -> following Monday). Inauguration Day is not included.
 * Derived by rule and cross-checked in tests/workflows/business-days.test.ts.
 */
export const US_FEDERAL_HOLIDAYS: readonly { date: string; name: string }[] = [
  { date: '2025-01-01', name: "New Year's Day" },
  { date: '2025-01-20', name: 'Birthday of Martin Luther King, Jr.' },
  { date: '2025-02-17', name: "Washington's Birthday" },
  { date: '2025-05-26', name: 'Memorial Day' },
  { date: '2025-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2025-07-04', name: 'Independence Day' },
  { date: '2025-09-01', name: 'Labor Day' },
  { date: '2025-10-13', name: 'Columbus Day' },
  { date: '2025-11-11', name: 'Veterans Day' },
  { date: '2025-11-27', name: 'Thanksgiving Day' },
  { date: '2025-12-25', name: 'Christmas Day' },
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Birthday of Martin Luther King, Jr.' },
  { date: '2026-02-16', name: "Washington's Birthday" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2026-07-03', name: 'Independence Day' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: 'Veterans Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Birthday of Martin Luther King, Jr.' },
  { date: '2027-02-15', name: "Washington's Birthday" },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth National Independence Day' },
  { date: '2027-07-05', name: 'Independence Day' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-10-11', name: 'Columbus Day' },
  { date: '2027-11-11', name: 'Veterans Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-12-24', name: 'Christmas Day' },
  { date: '2027-12-31', name: "New Year's Day" },
  { date: '2028-01-17', name: 'Birthday of Martin Luther King, Jr.' },
  { date: '2028-02-21', name: "Washington's Birthday" },
  { date: '2028-05-29', name: 'Memorial Day' },
  { date: '2028-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2028-07-04', name: 'Independence Day' },
  { date: '2028-09-04', name: 'Labor Day' },
  { date: '2028-10-09', name: 'Columbus Day' },
  { date: '2028-11-10', name: 'Veterans Day' },
  { date: '2028-11-23', name: 'Thanksgiving Day' },
  { date: '2028-12-25', name: 'Christmas Day' },
];

const HOLIDAY_DATES: ReadonlySet<string> = new Set(US_FEDERAL_HOLIDAYS.map((h) => h.date));

/** `ymd` is a YYYY-MM-DD local calendar date. */
export function isUsFederalHoliday(ymd: string): boolean {
  return HOLIDAY_DATES.has(ymd);
}
