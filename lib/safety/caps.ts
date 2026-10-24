import type { SafetyContact, Timestamp } from './types';
import { addBusinessDays } from '../workflows/business-days';
import { parseTimeScale, scaleDeadline } from '../workflows/clock';

export const MAX_ACTIVE_CONTACTS = 5;
export const FOLLOW_UP_BUSINESS_DAYS = [3, 7] as const;
const terminal = new Set(['declined', 'stalled', 'appointment_booked', 'connected']);
export function activeContactCount(contacts: readonly SafetyContact[]): number {
  return contacts.filter(contact => !terminal.has(contact.state)).length;
}

/** Active resources: active contacts grouped by targetId (a contact without one counts on its own). */
export function activeTargetIds(contacts: readonly SafetyContact[]): Set<string> {
  const ids = new Set<string>();
  contacts.forEach((contact, i) => {
    if (!terminal.has(contact.state)) ids.add(contact.targetId ? `t:${contact.targetId}` : `c:${contact.id ?? contact.address ?? i}`);
  });
  return ids;
}

/**
 * Real time uses the workflow business-day calendar (weekends and US federal holidays).
 * WAYFINDER_SIM_TIME_SCALE compresses that same deadline for the demo (1440 ≈ one simulated
 * day per real minute). Production ignores the variable so the cadence rule is unchanged.
 */
function followUpScale(): number {
  if (process.env.NODE_ENV === 'production') return 1;
  return parseTimeScale(process.env.WAYFINDER_SIM_TIME_SCALE);
}

/** Deadline is addBusinessDays from lastSentAt, then compressed by the sim scale. */
export function canFollowUp(lastSentAt: Timestamp, followUpsSent: number, now: Timestamp): boolean {
  if (!Number.isInteger(followUpsSent) || followUpsSent < 0 || followUpsSent >= FOLLOW_UP_BUSINESS_DAYS.length) return false;
  const anchor = new Date(lastSentAt);
  const current = new Date(now);
  if (!Number.isFinite(anchor.getTime()) || !Number.isFinite(current.getTime())) return false;
  const real = addBusinessDays(anchor, FOLLOW_UP_BUSINESS_DAYS[followUpsSent]);
  const due = scaleDeadline(anchor, real, followUpScale());
  return current.getTime() >= due.getTime();
}
