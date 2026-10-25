/**
 * Contact enrichment (code only, no model). One Exa search per target, results accepted only on the target's own web
 * host, then deterministic classifiers stamp contact_point.* rows with that page as source: the intake-door classifier
 * (role emails, practice intake phones) and the online-form detector (contact_point.web_form.*).
 *  - Institutions without a phone: search for the new-patient / appointment / referral page.
 *  - Institutions with a phone but no email and no online form: search for the appointment-request form page.
 *  - Organizations (advocacy / financial / travel aid) without an email: search for the contact / apply page.
 */
import type { Evidence } from '@/lib/contracts/evidence';
import type { ExaPort, ExaResult } from '@/lib/agents/research/source-ports';
import { institutionTokens, pageMatchesInstitution } from '@/lib/experts/affiliation';
import { intakeQuery } from '@/lib/experts/consultation';
import { contactRoutesOf, type ReachabilityEvidence } from '@/lib/outreach/reachability';
import { classifyIntakeDoors } from './index';
import { contactPointEvidence, contactPointsFromDoors } from './contact-points';
import { webFormsOnPage } from './web-forms';
import { webFormEvidence } from '../plan/contact-points';

export const MAX_ENRICHED_INSTITUTIONS = 8;
export const MAX_ENRICHED_ORGANIZATIONS = 4;
/** Rows kept from one search; each search (phone, then form) has its own room so phones never crowd out the form. */
const MAX_ROWS_PER_QUERY = 3;
const RESULTS = 5;
/** Registries and aggregators never count as the institution's own site. */
const NOT_OWN_HOST = /(?:^|\.)(?:cancer\.gov|nih\.gov|clinicaltrials\.gov|wikipedia\.org|healthgrades\.com|vitals\.com|webmd\.com|yelp\.com|facebook\.com|linkedin\.com|zocdoc\.com|usnews\.com)$/;

export interface EnrichTarget {
  targetKind: 'institution' | 'organization';
  targetId: string;
  name: string;
  evidence: readonly ReachabilityEvidence[];
  /** The record's own site (an organization's tool-returned url), when known. */
  siteUrl?: string;
}

/** Search queries: a form page for an institution that already has a phone, the contact / apply page for an organization. */
export const formQuery = (name: string): string => `"${name}" request an appointment online form`;
export const organizationContactQuery = (name: string): string => `"${name}" contact us`;
/** Exa itself is capped at 3 requests/s (shared limiter); more workers only overlap network latency. */
const CONCURRENCY = 6;

const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};
const compact = (host: string) => host.normalize('NFKD').replace(/[.-]/g, '');

/** Hosts of the institution's own pages already in its evidence (an exa page whose host carries a distinctive name token). */
export function ownHosts(name: string, evidence: readonly ReachabilityEvidence[]): string[] {
  const tokens = institutionTokens(name);
  const hosts = evidence.filter((e) => e.sourceKind === 'exa').flatMap((e) => { const h = hostOf(e.sourceUrl); return h ? [h] : []; });
  return [...new Set(hosts.filter((h) => !NOT_OWN_HOST.test(h) && tokens.some((t) => compact(h).includes(t))))];
}

/**
 * The page is on the institution's site: the strict host match (every distinctive token / known domain), the host
 * (or a parent domain) of one of its own evidence pages, or a host carrying most of its distinctive tokens.
 */
export function onInstitutionSite(name: string, url: string, own: readonly string[]): boolean {
  const host = hostOf(url);
  if (!host || NOT_OWN_HOST.test(host)) return false;
  if (pageMatchesInstitution(name, { url })) return true;
  if (own.some((h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`))) return true;
  const tokens = institutionTokens(name);
  const hits = tokens.filter((t) => compact(host).includes(t)).length;
  return tokens.length >= 2 && hits >= 2 && hits * 2 >= tokens.length;
}

const channelsOf = (evidence: readonly ReachabilityEvidence[]) => new Set(contactRoutesOf(evidence).map((r) => r.channel));

export const hasVoice = (evidence: readonly ReachabilityEvidence[]): boolean => channelsOf(evidence).has('voice');

/** Which search (if any) a target needs: none when it already has every route enrichment could add. */
export function enrichmentQuery(target: EnrichTarget): string | null {
  if (institutionTokens(target.name).length === 0) return null;
  const channels = channelsOf(target.evidence);
  if (target.targetKind === 'organization') return channels.has('email') ? null : organizationContactQuery(target.name);
  if (!channels.has('voice')) return intakeQuery(target.name);
  return channels.has('email') || channels.has('web_form') ? null : formQuery(target.name);
}

/** The page is on the target's own site: its known site host (or a sub/parent domain), else the name-token host match. */
function onOwnSite(target: EnrichTarget, url: string, own: readonly string[]): boolean {
  const site = target.siteUrl ? hostOf(target.siteUrl) : null;
  const known = site && !NOT_OWN_HOST.test(site) ? [...own, site] : own;
  return onInstitutionSite(target.name, url, known);
}

/** Code-stamped contact point rows (role email, intake phone, online form) on one fetched own-site page. */
function pageRows(r: ExaResult, fetchedAt: string): Array<Evidence & { id: string; channel: string; address: string }> {
  const page = { url: r.url, title: r.title, text: r.text, links: r.links };
  const doors = contactPointsFromDoors(classifyIntakeDoors(page)).flatMap((cp) => {
    const row = contactPointEvidence(cp, fetchedAt);
    return row?.id ? [{ ...row, id: row.id, channel: cp.channel as string, address: cp.address }] : [];
  });
  const forms = webFormsOnPage(page).flatMap((wf) => {
    const row = webFormEvidence(wf, fetchedAt);
    return row?.id ? [{ ...row, id: row.id, channel: 'web_form', address: wf.url }] : [];
  });
  return [...doors, ...forms];
}

/** Rows from one search for one target, skipping routes it already has (`have` is updated). [] on any failure. */
async function rowsForQuery(target: EnrichTarget, query: string, exa: ExaPort, fetchedAt: string, have: Set<string>, room: number): Promise<Array<Evidence & { id: string }>> {
  let results: ExaResult[];
  try { results = await exa.search({ query, numResults: RESULTS }); } catch { return []; }
  try {
    const own = ownHosts(target.name, target.evidence);
    const out: Array<Evidence & { id: string }> = [];
    for (const r of results ?? []) {
      if (!r || typeof r.url !== 'string' || !/^https?:/i.test(r.url) || !onOwnSite(target, r.url, own)) continue;
      for (const { channel, address, ...row } of pageRows(r, fetchedAt)) {
        const key = `${channel}:${address}`;
        if (have.has(key) || out.length >= room) continue;
        have.add(key);
        out.push(row);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Searches per target: an institution that only gained its phone here still gets the online-form search. */
const MAX_QUERIES_PER_TARGET = 2;

/** Contact point rows (with ids) for one target from pages on its own site; [] when not needed or on any failure. */
export async function institutionContactRows(target: EnrichTarget, exa: ExaPort, fetchedAt: string): Promise<Array<Evidence & { id: string }>> {
  const have = new Set(contactRoutesOf(target.evidence).map((r) => `${r.channel}:${r.address}`));
  const out: Array<Evidence & { id: string }> = [];
  const asked = new Set<string>();
  for (let i = 0; i < MAX_QUERIES_PER_TARGET; i++) {
    const query = enrichmentQuery({ ...target, evidence: [...target.evidence, ...out] });
    if (!query || asked.has(query)) break;
    asked.add(query);
    out.push(...await rowsForQuery(target, query, exa, fetchedAt, have, MAX_ROWS_PER_QUERY));
  }
  return out;
}

/** Alias: the same own-site enrichment works for any target kind. */
export const targetContactRows = institutionContactRows;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Enrich up to MAX_ENRICHED_INSTITUTIONS institutions (those without a phone first, then those with a phone but no
 * email / online form) and MAX_ENRICHED_ORGANIZATIONS organizations without an email, 3 searches at a time. Never throws.
 */
export async function enrichInstitutions(
  targets: readonly EnrichTarget[], exa: ExaPort, fetchedAt: string,
  /** Optional: filled as each target finishes, so a caller with a time budget can keep the targets that completed. */
  partial?: Map<string, Array<Evidence & { id: string }>>,
): Promise<Map<string, Array<Evidence & { id: string }>>> {
  const needing = targets.filter((t) => enrichmentQuery(t) !== null);
  const institutions = needing.filter((t) => t.targetKind === 'institution');
  const todo = [
    ...[...institutions.filter((t) => !hasVoice(t.evidence)), ...institutions.filter((t) => hasVoice(t.evidence))].slice(0, MAX_ENRICHED_INSTITUTIONS),
    ...needing.filter((t) => t.targetKind === 'organization').slice(0, MAX_ENRICHED_ORGANIZATIONS),
  ];
  const rows = await mapLimit(todo, CONCURRENCY, async (t) => {
    const found = await institutionContactRows(t, exa, fetchedAt).catch(() => []);
    if (found.length > 0) partial?.set(t.targetId, found);
    return found;
  });
  return new Map(todo.map((t, i) => [t.targetId, rows[i] ?? []] as const).filter(([, r]) => r.length > 0));
}
