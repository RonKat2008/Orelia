import type { Evidence } from '@/lib/contracts/evidence';
import type { ExaPort, NppesPort, NppesProvider } from '@/lib/agents/research/source-ports';
import { cleanField } from '@/lib/agents/research/untrusted';
import { parsePlanContactPoints } from '@/lib/plan/contact-points';
import { EXPERT_CLAIM_TYPES, expertTraceSchema, type ExpertChain, type ExpertTrace, type ReachRoute, type TraceEvidence } from './contract';
import { stateFromAffiliation } from '@/lib/agents/research/geo';
import { extractInstitution, pageMatchesInstitution, slugify } from './affiliation';
import { assessNppes, nppesRegistryUrl, pageShowsPatientCare, type NppesAssessment } from './sees-patients';
import { classifyInstitutionPages, consultationQuery, intakeQuery, type AcceptedPage } from './consultation';
import { parseAffiliationEvidence } from '@/lib/identity/affiliation-evidence';
import { classifyIntakeDoors } from '@/lib/contact-finder';
import { contactPointEvidence, contactPointsFromDoors, usPhoneToE164 } from '@/lib/contact-finder/contact-points';

export const MAX_AUTHORS = 6;
export const MAX_PAPERS_PER_AUTHOR = 2;
export const MAX_CHAINS = 30;
const CONCURRENCY = 3;

export interface TraceExpert {
  id: string;
  name: string;
  npi?: string | null;
  institutionId?: string;
  profile?: { paperCount?: number; recentPaperCount?: number; affiliation?: string; state?: string };
}

export interface TraceInputEvidence extends Omit<Evidence, 'id'> {
  id?: string;
  targetKind: string;
  targetId: string;
}

export interface TraceInput {
  caseId: string;
  diseaseName: string;
  homeState?: string;
  experts: readonly TraceExpert[];
  evidence: readonly TraceInputEvidence[];
}

export interface TracePorts { nppes: NppesPort; exa: ExaPort; now: Date }

interface Paper { pmid: string; title: string; url: string; year?: number }

const PUBMED_URL = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/;

/** Papers cited by this expert's pubmed evidence rows (URL carries the PMID; title only when the claim names one). */
export function papersFor(expert: TraceExpert, evidence: readonly TraceInputEvidence[]): Paper[] {
  const seen = new Map<string, Paper>();
  for (const e of evidence) {
    if (e.targetKind !== 'expert' || e.targetId !== expert.id || e.sourceKind !== 'pubmed') continue;
    const pmid = PUBMED_URL.exec(e.sourceUrl)?.[1];
    if (!pmid || seen.has(pmid)) continue;
    const titled = /is listed as an author of (?!PMID)([^;]+?)(?:;|$)/.exec(e.claim)?.[1];
    const title = cleanField(titled, 300) || `PubMed article ${pmid}`;
    seen.set(pmid, { pmid, title, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` });
  }
  return [...seen.values()];
}

const AFFILIATIONS = /listed affiliations?: (.+)$/;

const ownRows = (expert: TraceExpert, evidence: readonly TraceInputEvidence[]) =>
  evidence.filter((e) => e.targetKind === 'expert' && e.targetId === expert.id);

/** Stored identity.affiliation rows (code-stamped from the PubMed record), in evidence order. */
function storedAffiliations(expert: TraceExpert, evidence: readonly TraceInputEvidence[]): Array<{ pmid: string; affiliation: string }> {
  return ownRows(expert, evidence).flatMap((e) => { const a = parseAffiliationEvidence(e); return a ? [a] : []; });
}

/**
 * The expert's affiliation text: a stored identity.affiliation row naming an institution first (that is what survives
 * in Postgres), then the in-memory PubMed profile, then any older pubmed row that lists one.
 */
function affiliationFor(expert: TraceExpert, evidence: readonly TraceInputEvidence[]): string | undefined {
  const stored = storedAffiliations(expert, evidence);
  const named = stored.find((a) => extractInstitution(a.affiliation));
  if (named) return named.affiliation;
  if (expert.profile?.affiliation) return expert.profile.affiliation;
  for (const e of ownRows(expert, evidence)) {
    const m = AFFILIATIONS.exec(e.claim);
    if (m?.[1]) return m[1];
  }
  return stored[0]?.affiliation;
}

/**
 * The paper whose own evidence row lists this institution for the expert, if any. Only such a row may be cited as
 * "PMID X lists NAME with affiliation INST"; a profile-level affiliation is not tied to one paper.
 */
function affiliationPaper(expert: TraceExpert, evidence: readonly TraceInputEvidence[], instName: string): { pmid: string; url: string } | null {
  const stored = storedAffiliations(expert, evidence).find((a) => extractInstitution(a.affiliation) === instName);
  if (stored) return { pmid: stored.pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${stored.pmid}/` };
  for (const e of ownRows(expert, evidence)) {
    if (e.sourceKind !== 'pubmed') continue;
    const pmid = PUBMED_URL.exec(e.sourceUrl)?.[1];
    const listed = AFFILIATIONS.exec(e.claim)?.[1];
    if (!pmid || !listed) continue;
    if (listed.split(/;\s+/).some((a) => extractInstitution(a) === instName)) return { pmid, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` };
  }
  return null;
}

const pubmedAuthorSearchUrl = (name: string): string => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`${name}[Author]`)}`;

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Paper-affiliation location: the US state it names, else the comma segment right after the institution (city). */
function affiliationAnchor(affText: string | undefined, instName: string | null): { state?: string; city?: string } {
  const text = cleanField(affText, 600) ?? '';
  const state = text ? stateFromAffiliation(text) : undefined;
  if (state) return { state };
  const parts = text.split(/;\s+/)[0]?.split(',').map((p) => p.trim()) ?? [];
  const at = instName ? parts.findIndex((p) => p.startsWith(instName)) : -1;
  const city = at >= 0 ? parts[at + 1]?.replace(/[.\d]+$/g, '').trim() : undefined;
  return city && /^[\p{L} .'-]{2,60}$/u.test(city) ? { city } : {};
}

const splitName = (name: string): { first: string; last: string } => {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts[parts.length - 1] ?? '' };
};

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface InstitutionFacts {
  institutionPage: AcceptedPage | null;
  consultation: AcceptedPage | null;
  /** Code-stamped phone / email contact points from intake pages on the institution's own host. */
  contacts: Array<{ evidence: Evidence & { id: string }; origin: string }>;
}

const NO_FACTS: InstitutionFacts = { institutionPage: null, consultation: null, contacts: [] };
const MAX_INSTITUTION_CONTACTS = 3;

/** Intake contact points (phone / role email) on result pages that belong to the institution. */
export function institutionContacts(institution: string, results: readonly { url: string; title?: string; text?: string }[], fetchedAt: string): InstitutionFacts['contacts'] {
  const out: InstitutionFacts['contacts'] = [];
  for (const r of results) {
    if (!/^https?:/i.test(r.url) || !pageMatchesInstitution(institution, { url: r.url })) continue;
    for (const cp of contactPointsFromDoors(classifyIntakeDoors({ url: r.url, title: r.title, text: r.text }))) {
      const row = contactPointEvidence(cp, fetchedAt);
      if (row?.id && !out.some((o) => o.evidence.id === row.id) && out.length < MAX_INSTITUTION_CONTACTS) out.push({ evidence: row as Evidence & { id: string }, origin: cp.origin });
    }
  }
  return out;
}

export async function traceExperts(input: TraceInput, ports: TracePorts): Promise<ExpertTrace> {
  const fetchedAt = ports.now.toISOString();
  const rows = new Map<string, TraceEvidence>();
  const addRow = (row: TraceEvidence): string => { if (!rows.has(row.id)) rows.set(row.id, row); return row.id; };

  const candidates = input.experts
    .map((expert) => ({ expert, papers: papersFor(expert, input.evidence) }))
    .filter((c) => c.papers.length > 0)
    .sort((a, b) => (b.expert.profile?.recentPaperCount ?? 0) - (a.expert.profile?.recentPaperCount ?? 0)
      || (b.expert.profile?.paperCount ?? 0) - (a.expert.profile?.paperCount ?? 0) || a.expert.name.localeCompare(b.expert.name))
    .slice(0, MAX_AUTHORS);

  const instCache = new Map<string, Promise<InstitutionFacts>>();
  const institutionFacts = (name: string): Promise<InstitutionFacts> => {
    let p = instCache.get(name);
    if (!p) {
      p = Promise.all([
        safe(() => ports.exa.search({ query: consultationQuery(name), numResults: 6 })),
        safe(() => ports.exa.search({ query: intakeQuery(name), numResults: 5 })),
      ]).then(([consult, intake]) => {
        const pages = classifyInstitutionPages(name, [...(consult ?? []), ...(intake ?? [])]);
        return { ...pages, contacts: institutionContacts(name, [...(intake ?? []), ...(consult ?? [])], fetchedAt) };
      });
      instCache.set(name, p);
    }
    return p;
  };

  const perAuthor = await mapLimit(candidates, CONCURRENCY, async ({ expert, papers }): Promise<ExpertChain[]> => {
    const slug = slugify(expert.name);
    const { first, last } = splitName(expert.name);
    const affText = affiliationFor(expert, input.evidence);
    const affInst = extractInstitution(affText);
    const anchor = affiliationAnchor(affText, affInst);
    const lookupState = expert.profile?.state ?? anchor.state;
    const chosen = papers.slice(0, MAX_PAPERS_PER_AUTHOR);
    // Sees patients is a per-author fact, shared by that author's chains.
    const nppesResult: NppesAssessment = await safe(() => ports.nppes.lookup({ firstName: first, lastName: last, ...(lookupState ? { state: lookupState } : {}) }))
      .then((r) => (r ? assessNppes(r.providers, first, last, anchor) : ({ kind: 'unknown', reason: 'lookup_failed' } as const)));
    // Institution: the paper affiliation; else the confirmed registry entry's organization name.
    const nppesOrg = nppesResult.kind === 'yes' ? cleanField(nppesResult.provider.raw?.basic?.organization_name, MAX_ORG)?.trim() || null : null;
    const instName = affInst ?? nppesOrg;
    const instSlug = instName ? slugify(instName) : null;
    const mk = (id: string, claimType: string, claim: string, sourceUrl: string, sourceKind: Evidence['sourceKind'], kind: 'expert' | 'institution' = 'expert'): TraceEvidence => ({
      id, claimType, claim: trunc(claim, 500), sourceUrl, sourceKind, fetchedAt,
      targetKind: kind, targetId: kind === 'expert' ? expert.id : `inst:${instSlug}`,
    });
    const facts = instName ? await institutionFacts(instName) : NO_FACTS;

    let seesRowId: string | null = null;
    let seesText = 'No patient-care listing could be confirmed from the national provider registry.';
    let npi: string | null = null;
    if (nppesResult.kind === 'yes') {
      const p = nppesResult.provider;
      seesRowId = addRow(mk(`xp:${slug}:sees_patients`, EXPERT_CLAIM_TYPES.seesPatients,
        `The national provider registry lists ${expert.name} as an individual provider (NPI ${p.npi}) with a patient-care taxonomy: ${nppesResult.taxonomy}.`,
        nppesRegistryUrl(p.npi), 'nppes'));
      seesText = `The national provider registry lists ${expert.name} as an individual provider with a patient-care taxonomy (${nppesResult.taxonomy}).`;
      npi = p.npi;
    } else {
      if (nppesResult.reason === 'multiple') seesText = 'More than one registry entry has this exact name, so the right person could not be confirmed.';
      else if (nppesResult.reason === 'non_clinical') seesText = 'The registry entry does not show a patient-care taxonomy, so seeing patients could not be confirmed.';
      else if (nppesResult.reason === 'location_mismatch') seesText = 'The registry entry with this name is not listed in the same state or city as the paper affiliation, so the right person could not be confirmed.';
      else if (nppesResult.reason === 'lookup_failed') seesText = 'The provider registry could not be reached, so seeing patients could not be confirmed.';
      if (instName) {
        const clinic = await safe(() => ports.exa.search({ query: `"${expert.name}" "${instName}" appointments patients`, numResults: 5 }));
        const hit = clinic?.find((r) => /^https?:/i.test(r.url) && !/\.(?:pdf|docx?)(?:$|[?#])/i.test(r.url) && pageMatchesInstitution(instName, { url: r.url, title: cleanField(r.title, 100) })
          && pageShowsPatientCare(cleanField(r.text, 4000), cleanField(r.title, 100), first, last));
        if (hit) {
          seesRowId = addRow(mk(`xp:${slug}:sees_patients`, EXPERT_CLAIM_TYPES.seesPatients,
            `A ${instName} page titled "${cleanField(hit.title, 100)}" names ${expert.name} with appointment or patient-care language.`, new URL(hit.url).href, 'exa'));
          seesText = `A page on the ${instName} site names ${expert.name} with appointment or patient-care language.`;
        }
      }
    }
    if (expert.npi && /^\d{10}$/.test(expert.npi) && !npi) npi = expert.npi;

    const instRowIds: string[] = [];
    let pageUrl: string | null = null;
    if (instName && instSlug) {
      if (facts.institutionPage) {
        pageUrl = facts.institutionPage.url;
        instRowIds.push(addRow(mk(`xp:inst-${instSlug}:institution_page`, EXPERT_CLAIM_TYPES.institutionPage,
          `${instName} has a web page titled "${facts.institutionPage.title}".`, facts.institutionPage.url, 'exa', 'institution')));
      }
    }
    let consultId: string | null = null;
    if (instName && instSlug && facts.consultation) {
      consultId = addRow(mk(`xp:inst-${instSlug}:consultation`, EXPERT_CLAIM_TYPES.consultation,
        `${instName} has a page titled "${facts.consultation.title}" describing a second-opinion or e-consultation program.`, facts.consultation.url, 'exa', 'institution'));
    }

    // Affiliation: cite the paper whose own row lists the institution; otherwise word it as PubMed results.
    // An institution known only from the registry cites the registry entry.
    const affPaper = affInst ? affiliationPaper(expert, input.evidence, affInst) : null;
    const affId = !instName ? null : !affInst && nppesOrg && nppesResult.kind === 'yes'
      ? addRow(mk(`xp:${slug}:nppes_organization`, EXPERT_CLAIM_TYPES.affiliation,
        `The national provider registry lists ${expert.name} (NPI ${nppesResult.provider.npi}) with the organization ${nppesOrg}.`, nppesRegistryUrl(nppesResult.provider.npi), 'nppes'))
      : affPaper
      ? addRow(mk(`xp:${slug}:${affPaper.pmid}:affiliation`, EXPERT_CLAIM_TYPES.affiliation,
        `PMID ${affPaper.pmid} lists ${expert.name} with the affiliation ${instName}.`, affPaper.url, 'pubmed'))
      : addRow(mk(`xp:${slug}:affiliation`, EXPERT_CLAIM_TYPES.affiliation,
        `PubMed results list ${expert.name} with the affiliation ${instName}.`, pubmedAuthorSearchUrl(expert.name), 'pubmed'));

    // Practice-location phone from the confirmed registry entry (structured field; never the mailing address phone).
    const nppesPhone = nppesResult.kind === 'yes' ? nppesVoiceRow(nppesResult.provider, fetchedAt) : null;
    const extra: TraceEvidence[] = [
      ...(nppesPhone ? [{ ...nppesPhone, targetKind: 'expert' as const, targetId: expert.id }] : []),
      ...(instSlug ? facts.contacts.map((c) => ({ ...c.evidence, targetKind: 'institution' as const, targetId: `inst:${instSlug}` })) : []),
    ];
    const reach = reachRoutes(expert, input.evidence, facts, consultId, instRowIds[0] ?? null, addRow, fetchedAt, extra);

    return chosen.map((paper): ExpertChain => {
      const authorshipId = addRow(mk(`xp:${slug}:${paper.pmid}:authorship`, EXPERT_CLAIM_TYPES.authorship,
        `${expert.name} is listed as an author of PMID ${paper.pmid}.`, paper.url, 'pubmed'));
      return {
        id: `${slug}:${paper.pmid}`,
        paper: { pmid: paper.pmid, title: paper.title, ...(paper.year ? { year: paper.year } : {}), url: paper.url, evidenceId: authorshipId },
        author: { name: expert.name, expertId: expert.id, npi, evidenceIds: [authorshipId, ...(nppesResult.kind === 'yes' && seesRowId ? [seesRowId] : [])] },
        institution: { name: instName, pageUrl, evidenceIds: [...(affId ? [affId] : []), ...instRowIds] },
        seesPatients: { verdict: seesRowId ? 'yes' : 'unknown', text: trunc(seesText, 400), evidenceIds: seesRowId ? [seesRowId] : [] },
        consultation: consultId && facts.consultation
          ? { verdict: 'yes', text: trunc(`${instName} has a page describing a second-opinion or e-consultation program.`, 400), evidenceIds: [consultId], url: facts.consultation.url }
          : { verdict: 'unknown', text: instName ? 'No second-opinion or e-consultation program page was found for this institution.' : 'No institution was identified, so no consultation program could be looked up.', evidenceIds: [], url: null },
        howToReach: reach,
      };
    });
  });

  const chains = perAuthor.flat().slice(0, MAX_CHAINS);
  const used = new Set(chains.flatMap((c) => [c.paper.evidenceId, ...c.author.evidenceIds, ...c.institution.evidenceIds,
    ...c.seesPatients.evidenceIds, ...c.consultation.evidenceIds, ...c.howToReach.map((r) => r.evidenceId)]));
  const trace = {
    caseId: input.caseId,
    tracedAt: fetchedAt,
    chains,
    evidence: [...rows.values()].filter((r) => used.has(r.id)),
  };
  return expertTraceSchema.parse(trace);
}

const MAX_ORG = 120;

/** The registry entry's practice-location phone as a code-stamped voice contact point row. */
function nppesVoiceRow(p: NppesProvider, fetchedAt: string): (Evidence & { id: string }) | null {
  const location = (p.raw?.addresses ?? []).find((a) => a.address_purpose === 'LOCATION' && a.telephone_number);
  const phone = usPhoneToE164(location?.telephone_number);
  if (!phone) return null;
  const row = contactPointEvidence({ channel: 'voice', address: phone, origin: 'nppes_location_phone', sourceUrl: nppesRegistryUrl(p.npi), sourceKind: 'nppes' }, fetchedAt);
  return row?.id ? (row as Evidence & { id: string }) : null;
}

const ROUTE_LABELS: Record<string, string> = {
  nppes_location_phone: 'Practice phone listed in the national provider registry',
  new_patient_line: 'New-patient line on the institution site',
  referral_coordinator: 'Referral line on the institution site',
  second_opinion_program: 'Second-opinion program contact',
  pathology_consult: 'Pathology consultation contact',
  nurse_navigator: 'Nurse navigator contact',
};

/** howToReach: only code-stamped contact_point.* rows on the expert / its institution, plus accepted pages. */
function reachRoutes(
  expert: TraceExpert, evidence: readonly TraceInputEvidence[], facts: InstitutionFacts,
  consultId: string | null, instPageId: string | null, addRow: (r: TraceEvidence) => string, fetchedAt: string,
  extra: readonly TraceEvidence[] = [],
): ReachRoute[] {
  const routes: ReachRoute[] = [];
  const owned = [
    ...evidence.filter((e) => (e.targetKind === 'expert' && e.targetId === expert.id)
      || (e.targetKind === 'institution' && expert.institutionId !== undefined && e.targetId === expert.institutionId)),
    ...extra,
  ];
  const seen = new Set<string>();
  for (const cp of parsePlanContactPoints(owned.flatMap((e) => (e.id ? [{ ...e, id: e.id }] : [])))) {
    const src = owned.find((e) => e.id === cp.evidenceId);
    const key = `${cp.channel}:${cp.address}`;
    if (!src || seen.has(key)) continue;
    seen.add(key);
    addRow({ ...src, id: cp.evidenceId, fetchedAt: src.fetchedAt || fetchedAt, targetKind: src.targetKind === 'institution' ? 'institution' : 'expert' } as TraceEvidence);
    routes.push({ channel: cp.channel as ReachRoute['channel'], label: ROUTE_LABELS[cp.origin] ?? `${cp.origin.replace(/_/g, ' ')} (${cp.sourceKind})`, address: cp.address, evidenceId: cp.evidenceId });
  }
  if (facts.consultation && consultId) routes.push({ channel: 'page', label: 'Second-opinion / e-consultation program page', address: facts.consultation.url, evidenceId: consultId });
  if (facts.institutionPage && instPageId && facts.institutionPage.url !== facts.consultation?.url) routes.push({ channel: 'page', label: 'Institution page', address: facts.institutionPage.url, evidenceId: instPageId });
  return routes.slice(0, 6);
}
