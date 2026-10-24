import type { RankingFactor } from "@/config/ranking";
import type { CaseInput, Resource } from "@/lib/contracts";
import { rank, type RankingCandidate, type RankingSignal } from "@/lib/ranking/rank";
import { matchNciCenters, type NciDataset } from "@/lib/sources/nci-centers";
import { stateDistanceMiles } from "./research/geo";
import { diseaseMatch, diseaseTerms, mentionStrength } from "./relevance";
import type { EvidenceWithId, VerifiedRecord } from "./verifier";

/**
 * Derive ranking signals from VERIFIED records only. Values are deterministic functions of code-stamped facts
 * (Resource.registry / Resource.profile and evidence claim types). Text is assembled here from those facts, and every
 * signal cites the evidence ids that back it (an unsupported signal is omitted and scores zero in rank()).
 * Signals describe fit and access to a resource, never treatment quality (HARD RULE 1).
 */

export type RankFn = typeof rank;
export type SignalSet = Partial<Record<RankingFactor, RankingSignal>>;
export type SignalCase = Pick<CaseInput, "diseaseName" | "subtype" | "homeState" | "travelLimitMiles" | "goals">;

const DEFAULT_TRAVEL_MILES = 500;
const BEYOND_LIMIT_REACH = 0.1;
const PAPERS_FOR_FULL_SCORE = 6;
const RECENT_FOR_FULL_SCORE = 3;
const TRIALS_LED_FOR_FULL_SCORE = 2;
const SITES_FOR_FULL_SCORE = 3;
const DEDICATED_CONDITIONS = 3;
const BASKET_CONDITIONS = 10;
const ACTIONABLE = /appl(y|ication)|grant|reimburs|assistance|fund|program|helpline|navigator/i;
const CONTACT_PATH = /appl(y|ication)|contact|phone|email|helpline|intake/i;

const round2 = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
const ids = (evidence: readonly EvidenceWithId[]): string[] => [...new Set(evidence.map((e) => e.id))].sort();

function signal(value: number, text: string, evidence: readonly EvidenceWithId[]): RankingSignal | undefined {
  return evidence.length === 0 ? undefined : { value: round2(value), text, evidenceIds: ids(evidence) };
}

/** 1 in the home state, 0.5-1 within the travel limit, 0.1 beyond it; undefined when a state is unknown. */
function reach(from: string | undefined, to: string | undefined, limit: number | undefined): { value: number; miles: number } | undefined {
  const miles = stateDistanceMiles(from, to);
  if (miles === undefined) return undefined;
  const max = limit ?? DEFAULT_TRAVEL_MILES;
  if (miles === 0) return { value: 1, miles };
  return { value: miles <= max ? 1 - 0.5 * (miles / max) : BEYOND_LIMIT_REACH, miles };
}

const distanceText = (miles: number, home: string | undefined): string =>
  miles === 0 ? `in the home state (${home})` : `about ${miles} miles (state-to-state) from ${home ?? "home"}`;

const normName = (s: string): string[] => s.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(Boolean);

function leadsTrial(expertName: string, investigators: readonly string[]): boolean {
  const parts = normName(expertName);
  const first = parts[0];
  const last = parts[parts.length - 1];
  return investigators.some((i) => {
    const tokens = normName(i);
    return !!first && !!last && tokens.includes(first) && tokens.includes(last);
  });
}

const ctgov = (r: VerifiedRecord) => r.evidence.filter((e) => e.sourceKind === "ctgov");

// ---------- trials ----------

const PHASE_VALUE: Record<string, number> = {
  PHASE3: 1, PHASE2_PHASE3: 1, PHASE2: 0.8, PHASE1_PHASE2: 0.6, PHASE1: 0.4, EARLY_PHASE1: 0.3, NA: 0.5,
};

function phaseValue(phases: readonly string[]): { value: number; label: string } {
  const key = [...phases].sort().join("_") || "NA";
  const direct = PHASE_VALUE[key];
  if (direct !== undefined) return { value: direct, label: phases.map((p) => p.replace("PHASE", "Phase ")).join("/") || "no phase listed" };
  const best = Math.max(...phases.map((p) => PHASE_VALUE[p] ?? 0.5));
  return { value: best, label: phases.map((p) => p.replace("PHASE", "Phase ")).join("/") };
}

function trialSignals(r: Extract<Resource, { kind: "trial" }>, rec: VerifiedRecord, c: SignalCase): SignalSet {
  const ev = ctgov(rec);
  const reg = r.registry;
  if (!reg) return {};
  const out: SignalSet = {};
  const m = diseaseMatch(reg, r.title, diseaseTerms(c));
  if (m) {
    // A dedicated study lists few conditions; an umbrella study that names the disease among dozens is a weaker match.
    const n = reg.conditions.length;
    const listed = n <= DEDICATED_CONDITIONS ? 1 : n <= BASKET_CONDITIONS ? 0.85 : 0.7;
    const strength = { condition: listed, keyword: 0.6, title: 0.4 }[m.kind];
    const where = {
      condition: `in its registered conditions (${n} listed${listed < 1 ? "; a multi-condition study" : ""})`,
      keyword: "only in its keywords",
      title: "only in its title",
    }[m.kind];
    out.subtypeExpertise = signal(strength, `Disease match: "${m.phrase}" appears ${where}.`, ev);
  }
  const phase = phaseValue(reg.phases);
  out.institutionalFit = signal(phase.value, `Registry stage: ${phase.label}.`, ev);

  const nearest = reg.recruitingSiteStates
    .map((s) => reach(c.homeState, s, c.travelLimitMiles))
    .filter((x): x is { value: number; miles: number } => x !== undefined)
    .sort((a, b) => b.value - a.value)[0];
  if (reg.usRecruitingSiteCount > 0) {
    const sites = Math.min(1, reg.usRecruitingSiteCount / SITES_FOR_FULL_SCORE);
    const near = nearest ? ` Nearest recruiting site state: ${distanceText(nearest.miles, c.homeState)}.` : "";
    out.access = signal(
      0.5 * sites + 0.5 * (nearest?.value ?? 0),
      `${reg.usRecruitingSiteCount} of ${reg.usSiteCount} U.S. site(s) listed as recruiting.${near}`,
      ev,
    );
  } else {
    out.access = signal(0.1, `${reg.usSiteCount} U.S. site(s) listed, none marked recruiting in the registry.`, ev);
  }
  out.contactability = reg.hasContact
    ? signal(1, "The registry lists a central contact for this study.", ev)
    : signal(0.2, "No central contact listed; use the ClinicalTrials.gov study page.", ev);
  return out;
}

// ---------- experts ----------

function nciDatasetFrom(all: readonly VerifiedRecord[]): NciDataset {
  const centers = all.flatMap((a) => {
    const inst = a.resource;
    const nci = a.evidence.find((e) => e.sourceKind === "nci");
    if (inst.kind !== "institution" || !nci) return [];
    const designation = /(Comprehensive|Clinical|Basic Laboratory) Cancer Center/.exec(nci.claim)?.[0] ?? "NCI-designated cancer center";
    return [{ name: inst.name, city: inst.city ?? "", state: inst.state ?? "", designation, url: nci.sourceUrl }];
  });
  return { source_url: "https://www.cancer.gov/research/infrastructure/cancer-centers/find", generated_at: new Date(0).toISOString(), centers };
}

function expertSignals(r: Extract<Resource, { kind: "expert" }>, rec: VerifiedRecord, all: readonly VerifiedRecord[], c: SignalCase): SignalSet {
  const out: SignalSet = {};
  const pubs = rec.evidence.filter((e) => e.sourceKind === "pubmed");
  const identity = rec.evidence.filter((e) => e.sourceKind === "nppes" && e.claimType === "identity_verified");
  const led = all.filter(
    (a) => a.resource.kind === "trial" && a.resource.registry && leadsTrial(r.name, a.resource.registry.investigators),
  );
  const p = r.profile;
  if (p?.paperCount !== undefined || led.length > 0) {
    const papers = p?.paperCount ?? 0;
    const recent = p?.recentPaperCount ?? 0;
    const value =
      0.5 * Math.min(1, papers / PAPERS_FOR_FULL_SCORE) +
      0.25 * Math.min(1, recent / RECENT_FOR_FULL_SCORE) +
      0.25 * Math.min(1, led.length / TRIALS_LED_FOR_FULL_SCORE);
    const parts = [`${papers} PubMed paper(s) on ${c.diseaseName} in the retrieved set (${recent} in the last 5 years)`];
    if (led.length) parts.push(`listed as an overall official on ${led.length} recruiting trial(s)`);
    out.subtypeExpertise = signal(value, `${parts.join("; ")}.`, [...pubs, ...led.flatMap(ctgov)]);
  }

  const nciHits = p?.affiliation ? matchNciCenters(p.affiliation, nciDatasetFrom(all)).records : [];
  const nciEvidence = all.filter((a) => a.resource.kind === "institution" && nciHits.some((h) => h.name === (a.resource as { name: string }).name)).flatMap((a) => a.evidence.filter((e) => e.sourceKind === "nci"));
  const fitParts: string[] = [];
  if (r.verified && identity.length) fitParts.push("identity confirmed in NPPES (NPI " + r.npi + ")");
  if (nciHits[0]) fitParts.push(`paper affiliation matches ${nciHits[0].name} (${nciHits[0].designation})`);
  out.institutionalFit = signal(
    (r.verified ? 0.4 : 0) + (nciHits.length ? 0.6 : 0),
    `${fitParts.join("; ")}.`,
    [...(r.verified ? identity : []), ...nciEvidence, ...(nciHits.length ? pubs : [])],
  );
  if (fitParts.length === 0) delete out.institutionalFit;

  const where = reach(c.homeState, p?.state, c.travelLimitMiles);
  if (where) {
    out.access = signal(where.value, `Paper affiliation lists ${p?.state}: ${distanceText(where.miles, c.homeState)}.`, pubs);
  }
  if (r.verified && identity.length) {
    out.contactability = signal(0.5, "Listed in the NPPES registry with a practice location; no direct contact path found.", identity);
  }
  return out;
}

// ---------- institutions ----------

function institutionSignals(r: Extract<Resource, { kind: "institution" }>, rec: VerifiedRecord, c: SignalCase): SignalSet {
  const out: SignalSet = {};
  const nci = rec.evidence.filter((e) => e.sourceKind === "nci");
  const program = rec.evidence.filter((e) => e.claimType === "disease_program");
  const text = `${r.name} ${program.map((e) => e.claim).join(" ")}`;
  const strength = mentionStrength(text, c);
  if (program.length) {
    const value = strength === "exact" ? 1 : strength === "family" ? 0.8 : 0.5;
    out.subtypeExpertise = signal(value, `Web page describes a dedicated program or clinic (${strength === "none" ? "disease not named" : "names the disease or its family"}).`, program);
  } else if (nci.length) {
    out.subtypeExpertise = signal(0.4, "NCI-designated cancer center; no disease-specific program page found.", nci);
  }
  const claim = [...nci, ...program].map((e) => e.claim).join(" ");
  const designation = /Comprehensive/i.test(claim) ? ["Comprehensive designation", 1] : /Clinical Cancer/i.test(claim) ? ["Clinical designation", 0.6] : nci.length ? ["NCI listing", 0.4] : undefined;
  if (designation) {
    const selfReported = nci.length === 0;
    out.institutionalFit = signal(
      selfReported ? Math.min(0.8, designation[1] as number) : (designation[1] as number),
      `${designation[0]}${selfReported ? " (stated on the center's own page)" : " from the NCI center list"}.`,
      nci.length ? nci : program,
    );
  }
  const where = reach(c.homeState, r.state, c.travelLimitMiles);
  if (where) {
    out.access = signal(where.value, `${r.city ? `${r.city}, ` : ""}${r.state}: ${distanceText(where.miles, c.homeState)}.`, rec.evidence);
  }
  if (program.length) out.contactability = signal(0.6, "A program page is available to find intake information.", program);
  else if (nci.length) out.contactability = signal(0.3, "NCI profile page only; no intake information found.", nci);
  return out;
}

// ---------- organizations ----------

function organizationSignals(r: Extract<Resource, { kind: "organization" }>, rec: VerifiedRecord, c: SignalCase): SignalSet {
  const out: SignalSet = {};
  const text = `${r.name} ${r.url ?? ""} ${rec.evidence.map((e) => e.claim).join(" ")}`;
  const strength = mentionStrength(text, c);
  const spec = { exact: [1, "Disease-specific: names the disease."], family: [0.6, "Disease-family: names the broader condition group."], none: [0.2, "General rare-disease resource; disease not named."] } as const;
  out.subtypeExpertise = signal(spec[strength][0], spec[strength][1], rec.evidence);

  const wantsAid = c.goals.includes("aid");
  const wantsSupport = c.goals.includes("support");
  const isAid = r.organizationKind === "financial_aid" || r.organizationKind === "travel_aid";
  const matches = (isAid && wantsAid) || (r.organizationKind === "advocacy" && wantsSupport);
  const label = isAid ? "financial/travel aid" : "advocacy and support";
  out.institutionalFit = signal(matches ? 1 : 0.5, matches ? `Matches a stated goal (${label}).` : `Offers ${label}; not a stated goal.`, rec.evidence);

  const actionable = rec.evidence.some((e) => ACTIONABLE.test(e.claim));
  out.access = signal(actionable ? 0.8 : 0.4, actionable ? "Page describes a concrete program, grant or application." : "Informational page; no concrete program found.", rec.evidence);

  const contact = rec.evidence.some((e) => CONTACT_PATH.test(e.claim));
  if (r.url || contact) {
    out.contactability = signal(contact ? 1 : 0.6, contact ? "Page describes how to apply or make contact." : "Website available; no explicit contact path found.", rec.evidence);
  }
  return out;
}

export function computeSignals(record: VerifiedRecord, all: readonly VerifiedRecord[], c: SignalCase): SignalSet {
  const r = record.resource;
  const raw =
    r.kind === "trial" ? trialSignals(r, record, c)
    : r.kind === "expert" ? expertSignals(r, record, all, c)
    : r.kind === "institution" ? institutionSignals(r, record, c)
    : organizationSignals(r, record, c);
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as SignalSet;
}

export function toCandidate(
  record: VerifiedRecord,
  all: readonly VerifiedRecord[],
  c: SignalCase,
): RankingCandidate & { record: VerifiedRecord } {
  return { id: record.resource.id, signals: computeSignals(record, all, c), record };
}
