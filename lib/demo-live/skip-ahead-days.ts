/** DEMO ONLY: how far "Skip ahead" moves the clock. 5 calendar days is always at least 3 business days. */
export const SKIP_AHEAD_DAYS = 5;
export const SKIP_AHEAD_MS = SKIP_AHEAD_DAYS * 24 * 60 * 60 * 1000;

export const SKIP_AHEAD_LABEL = `Skip ahead ${SKIP_AHEAD_DAYS} days`;

export function skipAheadNote(shifted: number): string {
  return `Moved ${shifted} waiting contact(s) ${SKIP_AHEAD_DAYS} days ahead; follow-ups drafted for your approval.`;
}
