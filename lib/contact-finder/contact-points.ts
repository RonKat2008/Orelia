import type { Evidence, SourceKind } from '../contracts/evidence';
import { normalizeAddress } from '../safety/allowlist';
import { isRoleEmail, type IntakeDoor, type IntakeDoorKind } from './index';

/**
 * A contact point is an email or phone number taken from structured tool output (an intake-door classification of a
 * fetched page, an NPPES practice-location phone, a ClinicalTrials.gov central contact) together with the URL of the
 * record it came from. Contact points are written ONLY by code as evidence rows with a reserved claimType whose
 * claim is exactly the normalized address. Model-written evidence can never use these claim types (finalizeOutput
 * drops them), and outreach never mines addresses out of free-text claims (HARD RULE 2).
 */
export type ContactChannel = 'email' | 'voice';
export type ContactPointOrigin = IntakeDoorKind | 'nppes_location_phone' | 'ctgov_central_contact';

export interface ContactPoint {
  channel: ContactChannel;
  address: string;
  origin: ContactPointOrigin;
  sourceUrl: string;
  sourceKind: SourceKind;
}

const PREFIX = 'contact_point';
const ORIGINS: readonly ContactPointOrigin[] = [
  'new_patient_line', 'referral_coordinator', 'second_opinion_program', 'pathology_consult', 'nurse_navigator',
  'trial_contact', 'org_contact', 'nppes_location_phone', 'ctgov_central_contact',
];
/** Which tool may vouch for which origin. */
const ORIGIN_SOURCES: Record<ContactPointOrigin, readonly SourceKind[]> = {
  new_patient_line: ['exa'], referral_coordinator: ['exa'], second_opinion_program: ['exa'], pathology_consult: ['exa'],
  nurse_navigator: ['exa'], trial_contact: ['exa'], org_contact: ['exa'],
  nppes_location_phone: ['nppes'], ctgov_central_contact: ['ctgov'],
};

export function isContactPointClaimType(claimType: string): boolean {
  return claimType.trim().toLowerCase().startsWith(PREFIX);
}

const isHttpUrl = (url: string): boolean => {
  try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
};

export { usPhoneToE164 } from './phone';

/** Validate and normalize a contact point; null when it is not one outreach may ever use. */
export function contactPoint(input: ContactPoint): ContactPoint | null {
  if (!ORIGINS.includes(input.origin) || !ORIGIN_SOURCES[input.origin].includes(input.sourceKind) || !isHttpUrl(input.sourceUrl)) return null;
  const address = normalizeAddress(input.address);
  if (!address) return null;
  if (input.channel === 'email' && (!address.includes('@') || !isRoleEmail(address))) return null;
  if (input.channel === 'voice' && !/^\+[1-9]\d{7,14}$/.test(address)) return null;
  return { ...input, address };
}

/** Code-only constructor for the evidence row that carries a contact point. */
export function contactPointEvidence(input: ContactPoint, fetchedAt: string): Evidence | null {
  const cp = contactPoint(input);
  if (!cp) return null;
  return {
    id: `${PREFIX}:${cp.origin}:${cp.address}:${cp.sourceUrl}`,
    claimType: `${PREFIX}.${cp.channel}.${cp.origin}`,
    claim: cp.address,
    sourceUrl: cp.sourceUrl,
    sourceKind: cp.sourceKind,
    fetchedAt,
  };
}

/** Email and phone contact points from an intake-door classification of a fetched page. */
export function contactPointsFromDoors(doors: readonly IntakeDoor[]): ContactPoint[] {
  return doors.flatMap(door => [
    ...door.emails.map(address => ({ channel: 'email' as const, address })),
    ...(door.phones ?? []).map(address => ({ channel: 'voice' as const, address })),
  ].flatMap(({ channel, address }) => {
    const cp = contactPoint({ channel, address, origin: door.kind, sourceUrl: door.evidenceUrl, sourceKind: 'exa' });
    return cp ? [cp] : [];
  }));
}

/**
 * Read contact points back from stored evidence rows. Strict: the claim must BE the address (no searching inside
 * text), the claimType must be the reserved form, and the source kind must be one that can vouch for the origin.
 */
export function parseContactPoints(evidence: readonly { claimType: string; claim: string; sourceUrl: string; sourceKind?: string }[]): ContactPoint[] {
  return evidence.flatMap(e => {
    const [prefix, channel, origin, ...rest] = e.claimType.split('.');
    if (prefix !== PREFIX || rest.length || (channel !== 'email' && channel !== 'voice')) return [];
    if (normalizeAddress(e.claim) !== e.claim) return [];
    const cp = contactPoint({ channel, address: e.claim, origin: origin as ContactPointOrigin, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind as SourceKind });
    return cp ? [cp] : [];
  });
}
