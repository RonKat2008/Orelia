import type { SafetyContact, Timestamp } from './types';
export const MAX_ACTIVE_CONTACTS = 5;
export const FOLLOW_UP_BUSINESS_DAYS = [3, 7] as const;
const terminal = new Set(['declined', 'stalled', 'appointment_booked', 'connected']);
export function activeContactCount(contacts: readonly SafetyContact[]): number {
  return contacts.filter(contact => !terminal.has(contact.state)).length;
}
/** UTC weekdays, preserving time of day; holidays are not included in this core. */
export function canFollowUp(lastSentAt: Timestamp, followUpsSent: number, now: Timestamp): boolean {
  if (!Number.isInteger(followUpsSent) || followUpsSent < 0 || followUpsSent >= FOLLOW_UP_BUSINESS_DAYS.length) return false;
  const deadline = new Date(lastSentAt);
  const current = new Date(now);
  if (!Number.isFinite(deadline.getTime()) || !Number.isFinite(current.getTime())) return false;
  let remaining = FOLLOW_UP_BUSINESS_DAYS[followUpsSent];
  while (remaining > 0) {
    deadline.setUTCDate(deadline.getUTCDate() + 1);
    if (deadline.getUTCDay() !== 0 && deadline.getUTCDay() !== 6) remaining--;
  }
  return current.getTime() >= deadline.getTime();
}
