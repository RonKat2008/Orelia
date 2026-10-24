import { contactPointEvidence, type ContactPointOrigin } from '@/lib/contact-finder/contact-points';
import type { PlanEvidence, PlanResourceInput, PlanTargetKind } from '@/lib/plan/contract';
import { webFormEvidence, type WebFormOrigin } from '@/lib/plan/contact-points';

/** Synthetic fixtures only (example.org / 555 numbers). */
const FETCHED = '2026-10-01T00:00:00.000Z';
export const NOW = new Date('2026-10-24T12:00:00.000Z');

const toPlan = (e: { id?: string; claimType: string; claim: string; sourceUrl: string; sourceKind: PlanEvidence['sourceKind'] } | null): PlanEvidence => {
  if (!e?.id) throw new Error('fixture evidence rejected');
  return { id: e.id, claimType: e.claimType, claim: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind };
};

const sourceKindFor = (origin: ContactPointOrigin) =>
  origin === 'nppes_location_phone' ? 'nppes' : origin === 'ctgov_central_contact' ? 'ctgov' : 'exa';

export function emailEv(origin: ContactPointOrigin, address: string, page = 'https://example.org/contact'): PlanEvidence {
  return toPlan(contactPointEvidence({ channel: 'email', address, origin, sourceUrl: page, sourceKind: sourceKindFor(origin) }, FETCHED));
}

export function phoneEv(origin: ContactPointOrigin, address: string, page = 'https://example.org/contact'): PlanEvidence {
  return toPlan(contactPointEvidence({ channel: 'voice', address, origin, sourceUrl: page, sourceKind: sourceKindFor(origin) }, FETCHED));
}

export function formEv(origin: WebFormOrigin, url: string, page = 'https://example.org/apply'): PlanEvidence {
  return toPlan(webFormEvidence({ origin, url, sourceUrl: page, sourceKind: 'exa' }, FETCHED));
}

export function plainEv(id: string): PlanEvidence {
  return { id, claimType: 'specialty', claim: 'Sees adults with rare sarcoma', sourceUrl: 'https://example.org/about', sourceKind: 'exa' };
}

export function resource(targetKind: PlanTargetKind, targetId: string, evidence: PlanEvidence[], subKind: string | null = null): PlanResourceInput {
  return { targetKind, targetId, name: `Synthetic ${targetKind} ${targetId}`, contactId: `contact-${targetId}`, subKind, evidence };
}
