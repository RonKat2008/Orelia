import { neutralizeUntrusted } from '@/lib/agents/research/untrusted';
import { parseContactPoints, type ContactPointOrigin } from '@/lib/contact-finder/contact-points';
import type { PlanEvidence, PlanResourceInput } from '@/lib/plan/contract';
import { consultProcessSchema, type ConsultProcess } from '../contract';
import { ownDomains } from '../requirements/finder';
import type { ExaSearcher } from '../requirements/deps';

type ConsultProcessSchemaKind = ConsultProcess['kind'];

/**
 * Finds the expert's physician-facing consultation process from pages that were actually read (the resource's
 * evidence rows, then Exa results on the resource's own domain). Page text is untrusted data: it is neutralized and
 * only matched against fixed patterns, never followed. The expert address comes ONLY from a code-stamped contact
 * point evidence row (parseContactPoints), never from page text or model output.
 */
const RULES: [ConsultProcessSchemaKind, RegExp][] = [
  ['econsult', /\b(?:e-?consult(?:ation)?s?|electronic consult(?:ation)?s?|physician[- ]to[- ]physician (?:consult(?:ation)?s?|referrals?)|provider[- ]to[- ]provider consult(?:ation)?s?|clinician[- ]to[- ]clinician consult(?:ation)?s?)\b/i],
  ['tumor_board', /\b(?:tumou?r boards?|multidisciplinary (?:tumou?r )?(?:board|conference)s?)\b/i],
  ['peer_to_peer', /\b(?:peer[- ]to[- ]peer|physician (?:referral |access |consult )?(?:line|hotline)|doc(?:tor)?[- ]to[- ]doc(?:tor)?|physician-only line)\b/i],
  ['case_review', /\b(?:case reviews?|records? reviews?|remote (?:second )?opinions?|second[- ]opinion (?:review|program|consultation)s?|expert review of (?:records|slides|imaging))\b/i],
  ['referral_only', /\b(?:physician referral (?:is )?required|by (?:physician )?referral only|requires? a (?:physician |doctor'?s )?referral|referrals? (?:must|should) come from (?:a|your|the referring) (?:physician|doctor))\b/i],
];
const MAX_DETAIL = 300;
const EXA_RESULTS = 6;
const MAX_PAGE_CHARS = 20_000;
/** Most clinician-facing origins first. */
const ADDRESS_ORIGINS: readonly ContactPointOrigin[] = ['referral_coordinator', 'pathology_consult', 'second_opinion_program', 'new_patient_line', 'nurse_navigator', 'trial_contact', 'org_contact'];

export interface ConsultPage { url: string; text: string }

const isHttp = (url: string) => { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } };
const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const clip = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s);

/** Deterministic classification of sanitized text: first rule (by priority) that matches, with its sentence. */
export function classifyConsultText(text: string): { kind: ConsultProcessSchemaKind; detail: string } | null {
  const sentences = neutralizeUntrusted(text).split(/(?<=[.!?])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length > 8 && !/\[removed/i.test(s));
  for (const [kind, re] of RULES) {
    const hit = sentences.find(s => re.test(s));
    if (hit) return { kind, detail: clip(hit) };
  }
  return null;
}

/** The best email contact point among the resource's evidence rows, with the row id that vouches for it. */
export function pickExpertAddress(evidence: readonly PlanEvidence[]): { address: string; evidenceId: string } | null {
  const points = evidence.flatMap(e => parseContactPoints([e]).filter(p => p.channel === 'email').map(p => ({ p, id: e.id })));
  points.sort((a, b) => ADDRESS_ORIGINS.indexOf(a.p.origin) - ADDRESS_ORIGINS.indexOf(b.p.origin));
  const best = points[0];
  return best ? { address: best.p.address, evidenceId: best.id } : null;
}

async function exaPages(r: PlanResourceInput, exa: ExaSearcher): Promise<ConsultPage[]> {
  const pages: ConsultPage[] = [];
  for (const domain of ownDomains(r)) {
    try {
      const { records } = await exa.search(`${r.name} ${domain} physician referral e-consult tumor board case review peer-to-peer`, { numResults: EXA_RESULTS });
      for (const rec of records) {
        const host = hostOf(rec.url);
        if (host && onDomain(host, domain) && rec.text?.trim()) pages.push({ url: rec.url, text: rec.text.slice(0, MAX_PAGE_CHARS) });
      }
    } catch (err) {
      console.error('[consult] exa search failed', err instanceof Error ? err.name : 'error');
    }
  }
  return pages;
}

const NOT_FOUND_DETAIL = 'No physician-facing consultation process was found on the pages we read. Your doctor can still send the request through the contact below, or call the center.';

/**
 * Returns the process with a sourceUrl that was actually read, or null when the resource has no readable source at
 * all (then no request can be drafted).
 */
export async function discoverConsultProcess(r: PlanResourceInput, deps: { exa: ExaSearcher | null }): Promise<ConsultProcess | null> {
  const addr = pickExpertAddress(r.evidence);
  const withAddress = { expertAddress: addr?.address ?? null, addressEvidenceId: addr?.evidenceId ?? null };
  const evidencePages: ConsultPage[] = r.evidence
    .filter(e => !e.claimType.startsWith('contact_point.') && isHttp(e.sourceUrl))
    .map(e => ({ url: e.sourceUrl, text: e.claim }));
  const tryPages = (pages: ConsultPage[]) => {
    for (const page of pages) {
      const hit = classifyConsultText(page.text);
      if (hit) return consultProcessSchema.parse({ ...hit, sourceUrl: page.url, ...withAddress });
    }
    return null;
  };
  const fromEvidence = tryPages(evidencePages);
  if (fromEvidence) return fromEvidence;
  const fetched = deps.exa ? await exaPages(r, deps.exa) : [];
  const fromExa = tryPages(fetched);
  if (fromExa) return fromExa;
  const fallbackUrl = r.evidence.find(e => e.claimType.startsWith('contact_point.') && isHttp(e.sourceUrl))?.sourceUrl
    ?? fetched[0]?.url ?? evidencePages[0]?.url;
  return fallbackUrl ? consultProcessSchema.parse({ kind: 'unknown', detail: NOT_FOUND_DETAIL, sourceUrl: fallbackUrl, ...withAddress }) : null;
}
