/**
 * Single source of truth for "can Wayfinder reach this resource?". Built only on the code-stamped
 * `contact_point.*` evidence rows (parsePlanContactPoints): email, phone, and online intake/application/referral
 * forms. A plain program page URL is NOT a contact door, and scoring text is never consulted.
 */
import { parsePlanContactPoints, type PlanContactPoint } from '../plan/contact-points';
import type { PlanChannel, PlanEvidence } from '../plan/contract';

/** Any evidence row shape (id optional). */
export interface ReachabilityEvidence {
  id?: string;
  claimType: string;
  claim: string;
  sourceUrl: string;
  sourceKind?: string;
}

export interface ContactRouteSummary {
  channel: PlanChannel;
  label: string;
}

export function contactRoutesOf(evidence: readonly ReachabilityEvidence[]): PlanContactPoint[] {
  // Rows without an id (outreach candidates) get a stable synthetic one; the parser still requires the reserved claimType.
  const rows: PlanEvidence[] = evidence.map(e => ({ ...e, sourceKind: e.sourceKind as PlanEvidence['sourceKind'], id: e.id || `${e.claimType}:${e.claim}` }));
  return parsePlanContactPoints(rows);
}

export function isReachable(evidence: readonly ReachabilityEvidence[]): boolean {
  return contactRoutesOf(evidence).length > 0;
}

const LABELS: Record<PlanChannel, string> = {
  email: 'Email found',
  voice: 'Phone found',
  web_form: 'Online intake form found',
};
const ORDER: readonly PlanChannel[] = ['email', 'voice', 'web_form'];

/** Short human label for the best route (email, then phone, then online form), or null when there is none. */
export function reachabilityLabel(evidence: readonly ReachabilityEvidence[]): string | null {
  const channels = new Set(contactRoutesOf(evidence).map(r => r.channel));
  const best = ORDER.find(c => channels.has(c));
  return best ? LABELS[best] : null;
}

/** True when the only routes are online forms (no email/phone for the outreach channels). */
export function isWebFormOnly(evidence: readonly ReachabilityEvidence[]): boolean {
  const routes = contactRoutesOf(evidence);
  return routes.length > 0 && routes.every(r => r.channel === 'web_form');
}
