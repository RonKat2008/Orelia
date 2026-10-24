import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { PlanResourceInput } from '@/lib/plan/contract';
import type { RequirementsDeps } from './deps';
import { extractRequirements, formRequirements, type FetchedPage, type RequirementCandidate } from './extract';

/** Sources that describe a person or a study, not a center's own intake process. */
const NON_OWN_DOMAINS = ['pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'clinicaltrials.gov', 'npiregistry.cms.hhs.gov', 'doi.org', 'wikipedia.org'];
const MAX_DOMAINS = 2;
const MAX_FORMS = 2;
const EXA_RESULTS = 6;
const MAX_PAGE_CHARS = 20_000;

const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const isOwn = (host: string) => !NON_OWN_DOMAINS.some(d => onDomain(host, d));

export interface Gathered { candidates: RequirementCandidate[]; checkedUrls: string[] }

const webFormUrls = (r: PlanResourceInput) =>
  r.evidence.filter(e => e.claimType.startsWith('contact_point.web_form.')).map(e => e.claim);

/** The resource's own domains, from its evidence source URLs and web-form contact points. */
export function ownDomains(r: PlanResourceInput): string[] {
  const hosts = [...r.evidence.map(e => e.sourceUrl), ...webFormUrls(r)].map(hostOf).filter((h): h is string => !!h && isOwn(h));
  return [...new Set(hosts)].slice(0, MAX_DOMAINS);
}

const fixtureSchema = z.record(z.string(), z.array(z.object({ url: z.url(), text: z.string() })));
async function fixturePages(domains: string[]): Promise<FetchedPage[]> {
  try {
    const raw = JSON.parse(await readFile(resolve(process.cwd(), 'fixtures/coordination/requirements/pages.json'), 'utf8')) as Record<string, unknown>;
    const parsed = fixtureSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_'))));
    if (!parsed.success) return [];
    return domains.flatMap(d => (parsed.data[d] ?? []).map(p => ({ ...p, origin: 'fixture' as const })));
  } catch {
    return [];
  }
}

async function exaPages(r: PlanResourceInput, domains: string[], deps: RequirementsDeps): Promise<FetchedPage[]> {
  if (!deps.exa) return [];
  const pages: FetchedPage[] = [];
  for (const domain of domains) {
    try {
      const { records } = await deps.exa.search(`${r.name} ${domain} referral new patient medical records insurance intake`, { numResults: EXA_RESULTS });
      for (const rec of records) {
        const host = hostOf(rec.url);
        // Restricted to the resource's own domain: anything else is dropped.
        if (host && onDomain(host, domain) && rec.text?.trim()) pages.push({ url: rec.url, text: rec.text.slice(0, MAX_PAGE_CHARS), origin: 'exa' });
      }
    } catch (err) {
      console.error('[requirements] exa search failed', err instanceof Error ? err.name : 'error');
    }
  }
  return pages;
}

async function probed(urls: string[], deps: RequirementsDeps): Promise<{ candidates: RequirementCandidate[]; urls: string[] }> {
  const candidates: RequirementCandidate[] = [];
  const done: string[] = [];
  if (!deps.probe || deps.offline) return { candidates, urls: done };
  for (const url of urls.slice(0, MAX_FORMS)) {
    try {
      const { fields } = await deps.probe(url);
      done.push(url);
      candidates.push(...formRequirements(url, fields));
    } catch (err) {
      console.error('[requirements] form probe failed', err instanceof Error ? err.name : 'error');
    }
  }
  return { candidates, urls: done };
}

/** Collects raw requirement candidates for one resource. Every candidate's sourceUrl is a page actually read. */
export async function gatherRequirements(r: PlanResourceInput, deps: RequirementsDeps): Promise<Gathered> {
  const domains = ownDomains(r);
  const evidencePages: FetchedPage[] = r.evidence
    .filter(e => !e.claimType.startsWith('contact_point.') && /^https?:\/\//.test(e.sourceUrl))
    .map(e => ({ url: e.sourceUrl, text: e.claim, origin: 'evidence' as const }));
  const formEvidence: RequirementCandidate[] = r.evidence
    .filter(e => e.claimType.startsWith('contact_point.web_form.') && /^https?:\/\//.test(e.sourceUrl))
    .map(e => ({ kind: 'intake_form' as const, label: 'Online intake form', detail: `Online form: ${e.claim}`.slice(0, 300), sourceUrl: e.sourceUrl, origin: 'evidence' as const }));

  const web = deps.offline || !deps.exa ? await fixturePages(domains) : await exaPages(r, domains, deps);
  const pages = [...evidencePages, ...web];
  const probe = await probed(webFormUrls(r), deps);

  const candidates = [...formEvidence, ...extractRequirements(pages), ...probe.candidates];
  const fetched = new Set([...pages.map(p => p.url), ...probe.urls, ...formEvidence.map(c => c.sourceUrl)]);
  return {
    // Drop anything whose sourceUrl was not actually read (defense against model/tool slips).
    candidates: candidates.filter(c => fetched.has(c.sourceUrl)),
    checkedUrls: [...fetched],
  };
}
