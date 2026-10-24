/**
 * Contact enrichment (code only, no model): for an institution with no phone contact point, one Exa search for its
 * new-patient / appointment / referral page, accepted only on the institution's own web host, then the deterministic
 * intake-door classifier stamps contact_point.* rows (role emails, practice intake phones) with that page as source.
 */
import type { Evidence } from '@/lib/contracts/evidence';
import type { ExaPort, ExaResult } from '@/lib/agents/research/source-ports';
import { institutionTokens, pageMatchesInstitution } from '@/lib/experts/affiliation';
import { intakeQuery } from '@/lib/experts/consultation';
import { contactRoutesOf, type ReachabilityEvidence } from '@/lib/outreach/reachability';
import { classifyIntakeDoors } from './index';
import { contactPointEvidence, contactPointsFromDoors } from './contact-points';

export const MAX_ENRICHED_INSTITUTIONS = 8;
const MAX_ROWS_PER_TARGET = 3;
const RESULTS = 5;
/** Registries and aggregators never count as the institution's own site. */
const NOT_OWN_HOST = /(?:^|\.)(?:cancer\.gov|nih\.gov|clinicaltrials\.gov|wikipedia\.org|healthgrades\.com|vitals\.com|webmd\.com|yelp\.com|facebook\.com|linkedin\.com|zocdoc\.com|usnews\.com)$/;

export interface EnrichTarget {
  targetKind: 'institution';
  targetId: string;
  name: string;
  evidence: readonly ReachabilityEvidence[];
}

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

export const hasVoice = (evidence: readonly ReachabilityEvidence[]): boolean => contactRoutesOf(evidence).some((r) => r.channel === 'voice');

/** Contact point rows (with ids) for one institution from intake pages on its own site; [] on any failure. */
export async function institutionContactRows(target: EnrichTarget, exa: ExaPort, fetchedAt: string): Promise<Array<Evidence & { id: string }>> {
  if (hasVoice(target.evidence) || institutionTokens(target.name).length === 0) return [];
  let results: ExaResult[];
  try { results = await exa.search({ query: intakeQuery(target.name), numResults: RESULTS }); } catch { return []; }
  const own = ownHosts(target.name, target.evidence);
  const have = new Set(contactRoutesOf(target.evidence).map((r) => `${r.channel}:${r.address}`));
  const out: Array<Evidence & { id: string }> = [];
  for (const r of results) {
    if (!/^https?:/i.test(r.url) || !onInstitutionSite(target.name, r.url, own)) continue;
    for (const cp of contactPointsFromDoors(classifyIntakeDoors({ url: r.url, title: r.title, text: r.text }))) {
      const row = contactPointEvidence(cp, fetchedAt);
      const key = `${cp.channel}:${cp.address}`;
      if (!row?.id || have.has(key) || out.length >= MAX_ROWS_PER_TARGET) continue;
      have.add(key);
      out.push(row as Evidence & { id: string });
    }
  }
  return out;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Enrich up to MAX_ENRICHED_INSTITUTIONS targets (those without a phone), 3 at a time. Never throws. */
export async function enrichInstitutions(targets: readonly EnrichTarget[], exa: ExaPort, fetchedAt: string): Promise<Map<string, Array<Evidence & { id: string }>>> {
  const todo = targets.filter((t) => !hasVoice(t.evidence)).slice(0, MAX_ENRICHED_INSTITUTIONS);
  const rows = await mapLimit(todo, 3, (t) => institutionContactRows(t, exa, fetchedAt).catch(() => []));
  return new Map(todo.map((t, i) => [t.targetId, rows[i] ?? []] as const).filter(([, r]) => r.length > 0));
}
