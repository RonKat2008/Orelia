/**
 * "Refresh research" for an existing case: re-runs ONLY the code-stamped identity / contact-point steps and the
 * research-to-care trace, so cases researched before affiliations and phone contact points were stored get chains
 * and phone contacts without a full research re-run. Read-only lookups (PubMed, NPPES, Exa); contacts nobody.
 */
import type { CaseExpert, EvidenceAddition, Persist, ShortlistEvidence } from '@/lib/agents/persist';
import type { ExaPort, NppesPort, PubmedPort, PubmedAuthorHit } from '@/lib/agents/research/source-ports';
import { deterministicUuid } from '@/lib/agents/verifier';
import { enrichInstitutions } from '@/lib/contact-finder/enrich';
import { isContactPointClaimType } from '@/lib/contact-finder/contact-points';
import { affiliationEvidence, isAffiliationClaimType } from '@/lib/identity/affiliation-evidence';
import { isPaperClaimType, paperEvidence } from '@/lib/identity/paper-evidence';
import type { ExpertTrace } from './contract';
import { traceExperts, type TraceInput } from './trace';

export interface RefreshPorts { pubmed: PubmedPort; nppes: NppesPort; exa: ExaPort; now: Date }

export interface RefreshDeps {
  persist: Persist;
  ports: RefreshPorts;
  /** Builds the tracer input from what is persisted now (called after the new rows are saved). */
  loadTraceInput(caseId: string): Promise<TraceInput | null>;
  saveTrace(trace: ExpertTrace): Promise<ExpertTrace | null>;
}

export interface RefreshResult {
  trace: ExpertTrace;
  added: { affiliations: number; contactPoints: number; papers: number };
}

const MAX_AFFILIATIONS_PER_EXPERT = 2;
const MAX_PAPER_ROWS_PER_EXPERT = 5;
const AUTHOR_SEARCH_LIMIT = 15;
const PUBMED = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?$/;

const nameKey = (name: string): string => {
  const parts = name.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').trim().split(/\s+/);
  return `${parts[0] ?? ''}|${parts.at(-1) ?? ''}`;
};

const stableId = (caseId: string, a: { targetKind: string; targetId: string }, e: { sourceUrl: string; claimType: string; claim: string }) =>
  deterministicUuid(`refresh|${caseId}|${a.targetKind}:${a.targetId}|${e.sourceUrl}|${e.claimType}|${e.claim}`);

const toRow = (e: { claimType: string; claim: string; sourceUrl: string; sourceKind: string; fetchedAt: string }, id: string): ShortlistEvidence =>
  ({ id, claimType: e.claimType, claim: e.claim, sourceUrl: e.sourceUrl, sourceKind: e.sourceKind, fetchedAt: e.fetchedAt });

/** identity.affiliation rows for experts that have none, from one PubMed author search (their own papers first). */
export function affiliationAdditions(caseId: string, experts: readonly CaseExpert[], hits: readonly PubmedAuthorHit[], fetchedAt: string): EvidenceAddition[] {
  const byName = new Map<string, PubmedAuthorHit[]>();
  for (const h of hits) byName.set(nameKey(h.name), [...(byName.get(nameKey(h.name)) ?? []), h]);
  return experts.flatMap((x): EvidenceAddition[] => {
    if (x.evidence.some((e) => isAffiliationClaimType(e.claimType))) return [];
    const matches = byName.get(nameKey(x.name)) ?? [];
    if (matches.length !== 1) return []; // none, or two namesakes: never guess
    const own = new Set(x.evidence.flatMap((e) => { const m = PUBMED.exec(e.sourceUrl); return m ? [m[1]!] : []; }));
    const papers = [...matches[0]!.papers].filter((p) => p.affiliation).sort((a, b) => Number(own.has(b.pmid)) - Number(own.has(a.pmid)));
    const rows = papers.slice(0, MAX_AFFILIATIONS_PER_EXPERT).flatMap((p) => {
      const row = affiliationEvidence({ name: x.name, pmid: p.pmid, affiliation: p.affiliation, fetchedAt });
      return row ? [toRow(row, stableId(caseId, { targetKind: 'expert', targetId: x.id }, row))] : [];
    });
    return rows.length ? [{ targetKind: 'expert', targetId: x.id, evidence: rows }] : [];
  });
}

const citedPmids = (x: CaseExpert): string[] => [...new Set(x.evidence.flatMap((e) => (e.sourceKind === 'pubmed' ? [PUBMED.exec(e.sourceUrl)?.[1]] : [])).filter((p): p is string => !!p))];
const hasPaperRows = (x: CaseExpert, pmid: string): boolean => x.evidence.some((e) => isPaperClaimType(e.claimType) && e.sourceUrl === `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`);

/** True when an expert cites a PubMed paper that has no stored title / journal / year row yet. */
export const needsPaperRows = (x: CaseExpert): boolean => citedPmids(x).some((p) => !hasPaperRows(x, p));

/** publication.citation rows (title, journal, year) for the PubMed papers an expert already cites, from one PubMed author search. */
export function paperAdditions(caseId: string, experts: readonly CaseExpert[], hits: readonly PubmedAuthorHit[], fetchedAt: string): EvidenceAddition[] {
  const byName = new Map<string, PubmedAuthorHit[]>();
  for (const h of hits) byName.set(nameKey(h.name), [...(byName.get(nameKey(h.name)) ?? []), h]);
  return experts.flatMap((x): EvidenceAddition[] => {
    const matches = byName.get(nameKey(x.name)) ?? [];
    if (matches.length !== 1) return []; // none, or two namesakes: never guess
    const rows = citedPmids(x).filter((p) => !hasPaperRows(x, p)).slice(0, MAX_PAPER_ROWS_PER_EXPERT).flatMap((pmid) => {
      const paper = matches[0]!.papers.find((p) => p.pmid === pmid);
      const row = paper ? paperEvidence({ name: x.name, pmid, title: paper.title, journal: paper.journal, year: paper.year, fetchedAt }) : null;
      return row ? [toRow(row, stableId(caseId, { targetKind: 'expert', targetId: x.id }, row))] : [];
    });
    return rows.length ? [{ targetKind: 'expert', targetId: x.id, evidence: rows }] : [];
  });
}

/** Contact point rows the tracer stamped on an expert (NPPES practice phone) that the expert does not have yet. */
export function traceContactAdditions(caseId: string, trace: ExpertTrace, experts: readonly CaseExpert[]): EvidenceAddition[] {
  return experts.flatMap((x): EvidenceAddition[] => {
    const have = new Set(x.evidence.map((e) => `${e.claimType}|${e.claim}`));
    const rows = trace.evidence
      .filter((e) => e.targetKind === 'expert' && e.targetId === x.id && isContactPointClaimType(e.claimType) && !have.has(`${e.claimType}|${e.claim}`))
      .map((e) => toRow(e, stableId(caseId, { targetKind: 'expert', targetId: x.id }, e)));
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
    return unique.length ? [{ targetKind: 'expert', targetId: x.id, evidence: unique }] : [];
  });
}

export async function refreshResearch(caseId: string, diseaseName: string, deps: RefreshDeps): Promise<RefreshResult | null> {
  const fetchedAt = deps.ports.now.toISOString();
  const [experts, shortlist] = await Promise.all([deps.persist.getCaseExperts(caseId), deps.persist.getShortlist(caseId)]);

  // 1. Author affiliations (PubMed, one search).
  const needAffiliation = experts.filter((x) => !x.evidence.some((e) => isAffiliationClaimType(e.claimType)));
  const needPapers = experts.filter(needsPaperRows);
  const hits = needAffiliation.length || needPapers.length
    ? await deps.ports.pubmed.searchAuthors({ disease: diseaseName, limit: AUTHOR_SEARCH_LIMIT }).catch(() => [] as PubmedAuthorHit[])
    : [];
  const affiliations = affiliationAdditions(caseId, needAffiliation, hits, fetchedAt);
  const papers = paperAdditions(caseId, needPapers, hits, fetchedAt);

  // 2. Institution intake contact points (Exa, institution's own site only).
  const institutions = shortlist.filter((i) => i.targetKind === 'institution');
  const found = await enrichInstitutions(institutions.map((i) => ({ targetKind: 'institution' as const, targetId: i.targetId, name: i.name, evidence: i.evidence })), deps.ports.exa, fetchedAt);
  const contacts: EvidenceAddition[] = [...found].map(([targetId, rows]) => ({
    targetKind: 'institution', targetId, evidence: rows.map((r) => toRow(r, stableId(caseId, { targetKind: 'institution', targetId }, r))),
  }));

  await deps.persist.appendEvidence(caseId, [...affiliations, ...papers, ...contacts]);

  // 3. Trace (NPPES + Exa), then keep the tracer's code-stamped expert phone rows on the experts themselves.
  const input = await deps.loadTraceInput(caseId);
  if (!input) return null;
  const trace = await traceExperts(input, { nppes: deps.ports.nppes, exa: deps.ports.exa, now: deps.ports.now });
  const expertPhones = traceContactAdditions(caseId, trace, await deps.persist.getCaseExperts(caseId));
  await deps.persist.appendEvidence(caseId, expertPhones);
  const saved = await deps.saveTrace(trace);
  if (!saved) throw new Error('The trace could not be saved');
  const count = (adds: readonly EvidenceAddition[]) => adds.reduce((n, a) => n + a.evidence.length, 0);
  return { trace: saved, added: { affiliations: count(affiliations), contactPoints: count(contacts) + count(expertPhones), papers: count(papers) } };
}
