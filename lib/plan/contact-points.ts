/**
 * Contact points the planner may target. Email and phone rows reuse the contact finder's strict parser; online forms
 * are a planner addition with the same rules: written ONLY by code (webFormEvidence) as a reserved
 * `contact_point.web_form.<origin>` evidence row whose claim is exactly the normalized http(s) form URL. Model-written
 * evidence can never carry a contact_point.* claimType (finalizeOutput drops them), and nothing here mines addresses
 * or URLs out of free text.
 */
import type { Evidence, SourceKind } from '../contracts/evidence';
import { parseContactPoints, type ContactPointOrigin } from '../contact-finder/contact-points';
import type { PlanChannel, PlanEvidence } from './contract';

export type WebFormOrigin = 'application_form' | 'referral_form' | 'intake_form';
export const WEB_FORM_ORIGINS: readonly WebFormOrigin[] = ['application_form', 'referral_form', 'intake_form'];
/** Which tools may vouch for a form URL (it must come from a fetched page). */
const WEB_FORM_SOURCES: readonly SourceKind[] = ['exa'];

const PREFIX = 'contact_point';

export interface WebFormPoint {
  origin: WebFormOrigin;
  url: string;
  sourceUrl: string;
  sourceKind: SourceKind;
}

export type PlanContactOrigin = ContactPointOrigin | WebFormOrigin;

export interface PlanContactPoint {
  channel: PlanChannel;
  /** Normalized email, E.164 phone, or form URL. */
  address: string;
  origin: PlanContactOrigin;
  evidenceId: string;
  sourceUrl: string;
  sourceKind: SourceKind;
}

/** Normalized http(s) URL without embedded credentials, or null. */
export function normalizeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

const isWebFormOrigin = (o: string): o is WebFormOrigin => (WEB_FORM_ORIGINS as readonly string[]).includes(o);

function webFormPoint(input: WebFormPoint): WebFormPoint | null {
  if (!isWebFormOrigin(input.origin) || !WEB_FORM_SOURCES.includes(input.sourceKind)) return null;
  const url = normalizeHttpUrl(input.url);
  if (!url || !normalizeHttpUrl(input.sourceUrl)) return null;
  return { ...input, url };
}

/** Code-only constructor for the evidence row that carries an online form. */
export function webFormEvidence(input: WebFormPoint, fetchedAt: string): Evidence | null {
  const wf = webFormPoint(input);
  if (!wf) return null;
  return {
    id: `${PREFIX}:${wf.origin}:${wf.url}`,
    claimType: `${PREFIX}.web_form.${wf.origin}`,
    claim: wf.url,
    sourceUrl: wf.sourceUrl,
    sourceKind: wf.sourceKind,
    fetchedAt,
  };
}

function parseWebForm(e: PlanEvidence): PlanContactPoint | null {
  const [prefix, channel, origin, ...rest] = e.claimType.split('.');
  if (prefix !== PREFIX || channel !== 'web_form' || rest.length || !origin || !isWebFormOrigin(origin)) return null;
  if (normalizeHttpUrl(e.claim) !== e.claim) return null;
  const wf = webFormPoint({ origin, url: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind });
  return wf ? { channel: 'web_form', address: wf.url, origin, evidenceId: e.id, sourceUrl: wf.sourceUrl, sourceKind: wf.sourceKind } : null;
}

/**
 * Contact points from one resource's evidence rows, in row order. Strict: only reserved contact_point.* rows, the
 * claim must BE the address/URL, and the source kind must be one that can vouch for the origin.
 */
export function parsePlanContactPoints(evidence: readonly PlanEvidence[]): PlanContactPoint[] {
  return evidence.flatMap((e): PlanContactPoint[] => {
    if (!e.id || !e.claimType.startsWith(`${PREFIX}.`)) return [];
    if (e.claimType.startsWith(`${PREFIX}.web_form.`)) {
      const wf = parseWebForm(e);
      return wf ? [wf] : [];
    }
    return parseContactPoints([e]).map(cp => ({
      channel: cp.channel, address: cp.address, origin: cp.origin, evidenceId: e.id, sourceUrl: cp.sourceUrl, sourceKind: cp.sourceKind,
    }));
  });
}
