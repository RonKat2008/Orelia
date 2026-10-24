import type { CaseInput, Resource } from "@/lib/contracts";
import { sameInvestigator } from "@/lib/identity/eligibility";
import { matchNciCenters, type NciDataset } from "@/lib/sources/nci-centers";
import type { EvidenceWithId, VerifiedRecord } from "@/lib/agents/verifier";

/**
 * Documented-experience scoring for experts. Pure and deterministic: every component is a function of code-stamped
 * facts (profile counts, trial investigators, center lists) and cites only the evidence rows that back it. A component
 * with no evidence scores 0 and cites nothing; nothing is inferred. Text describes documented activity only, never
 * quality (HARD RULE 1).
 */

export type ExperienceKey = "disease_papers" | "recency" | "trials_led" | "center_designation";

export interface ExperienceComponent {
  key: ExperienceKey;
  label: string;
  /** 0..1 */
  value: number;
  /** This component's share of the combined value (the shares sum to 1). */
  weight: number;
  detail: string;
  evidenceIds: string[];
}

export interface DocumentedExperience {
  value: number;
  text: string;
  evidenceIds: string[];
  components: ExperienceComponent[];
}

export const EXPERIENCE_WEIGHTS: Readonly<Record<ExperienceKey, number>> = Object.freeze({
  disease_papers: 0.4,
  recency: 0.2,
  trials_led: 0.2,
  center_designation: 0.2,
});

export const PAPERS_FOR_FULL_SCORE = 6;
export const RECENT_FOR_FULL_SCORE = 3;
export const TRIALS_LED_FOR_FULL_SCORE = 2;
export const CENTER_TIER_VALUE = Object.freeze({ comprehensive: 1, clinical: 0.7, rareDisease: 0.7, otherNci: 0.5 });
const RECENT_YEARS = 5;

export type ExperienceCase = Pick<CaseInput, "diseaseName">;

const round2 = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
const uniqueIds = (evidence: readonly EvidenceWithId[]): string[] => [...new Set(evidence.map((e) => e.id))].sort();
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Build a center dataset from verified institution records that carry NCI evidence (shared with institutionalFit). */
export function nciDatasetFrom(all: readonly VerifiedRecord[]): NciDataset {
  const centers = all.flatMap((a) => {
    const inst = a.resource;
    const nci = a.evidence.find((e) => e.sourceKind === "nci");
    if (inst.kind !== "institution" || !nci) return [];
    const designation = /(Comprehensive|Clinical|Basic Laboratory) Cancer Center/.exec(nci.claim)?.[0] ?? "NCI-designated cancer center";
    return [{ name: inst.name, city: inst.city ?? "", state: inst.state ?? "", designation, url: nci.sourceUrl }];
  });
  return { source_url: "https://www.cancer.gov/research/infrastructure/cancer-centers/find", generated_at: new Date(0).toISOString(), centers };
}

interface CenterHit {
  name: string;
  designation: string;
  value: number;
  evidence: EvidenceWithId[];
}

const RARE_DESIGNATION = "rare-disease center";

/** NCI-designated centers (evidence: nci rows) and rare-disease-center institutions (evidence: their own rows). */
function centerHits(affiliation: string, all: readonly VerifiedRecord[]): CenterHit[] {
  const institutions = all.filter((a): a is VerifiedRecord & { resource: Extract<Resource, { kind: "institution" }> } => a.resource.kind === "institution");
  const nci = nciDatasetFrom(all);
  const rare = institutions.filter((a) => a.resource.institutionKind === "rare_disease_center" && !a.evidence.some((e) => e.sourceKind === "nci") && a.evidence.length > 0);
  const dataset: NciDataset = {
    ...nci,
    centers: [
      ...nci.centers,
      ...rare.map((a) => ({ name: a.resource.name, city: a.resource.city ?? "", state: a.resource.state ?? "", designation: RARE_DESIGNATION, url: a.evidence[0]!.sourceUrl })),
    ],
  };
  return matchNciCenters(affiliation, dataset).records.flatMap((hit) => {
    const inst = institutions.find((a) => a.resource.name === hit.name);
    if (!inst) return [];
    const isRare = hit.designation === RARE_DESIGNATION;
    const evidence = isRare ? inst.evidence : inst.evidence.filter((e) => e.sourceKind === "nci");
    if (evidence.length === 0) return [];
    const value = isRare ? CENTER_TIER_VALUE.rareDisease
      : /Comprehensive/i.test(hit.designation) ? CENTER_TIER_VALUE.comprehensive
      : /Clinical/i.test(hit.designation) ? CENTER_TIER_VALUE.clinical
      : CENTER_TIER_VALUE.otherNci;
    return [{ name: hit.name, designation: hit.designation, value, evidence }];
  }).sort((a, b) => b.value - a.value);
}

export function documentedExperience(
  expert: Extract<Resource, { kind: "expert" }>,
  record: VerifiedRecord,
  all: readonly VerifiedRecord[],
  c: ExperienceCase,
): DocumentedExperience {
  const profile = expert.profile;
  const pubs = record.evidence.filter((e) => e.sourceKind === "pubmed");
  const led = all.filter((a) => a.resource.kind === "trial" && a.resource.registry?.investigators.some((i) => sameInvestigator(expert.name, i)));
  const ledEvidence = led.flatMap((a) => a.evidence.filter((e) => e.sourceKind === "ctgov"));

  const papers = pubs.length > 0 ? profile?.paperCount ?? 0 : 0;
  const recent = pubs.length > 0 ? Math.min(papers, profile?.recentPaperCount ?? 0) : 0;
  const trials = ledEvidence.length > 0 ? led.length : 0;
  const hits = profile?.affiliation ? centerHits(profile.affiliation, all) : [];
  const best = hits[0];

  const mk = (key: ExperienceKey, label: string, value: number, detail: string, evidence: readonly EvidenceWithId[]): ExperienceComponent => {
    const evidenceIds = value > 0 ? uniqueIds(evidence) : [];
    return { key, label, value: evidenceIds.length ? round2(value) : 0, weight: EXPERIENCE_WEIGHTS[key], detail, evidenceIds };
  };

  const components: ExperienceComponent[] = [
    mk("disease_papers", "Disease-specific papers", papers / PAPERS_FOR_FULL_SCORE,
      papers > 0 ? `${papers} PubMed ${plural(papers, "paper")} on ${c.diseaseName} in the retrieved set` : "No disease-specific PubMed papers in the retrieved set", pubs),
    mk("recency", `Papers in the last ${RECENT_YEARS} years`, recent / RECENT_FOR_FULL_SCORE,
      recent > 0 ? `${recent} of those in the last ${RECENT_YEARS} years` : `None of the retrieved papers are from the last ${RECENT_YEARS} years`, pubs),
    mk("trials_led", "Trials led", trials / TRIALS_LED_FOR_FULL_SCORE,
      trials > 0 ? `Listed as overall official on ${trials} recruiting ${plural(trials, "trial")}` : "Not listed as overall official on a retrieved trial", ledEvidence),
    mk("center_designation", "Center designation", best?.value ?? 0,
      best ? `Affiliation matches ${best.name} (${best.designation})` : "No designated center matched the paper affiliation", best?.evidence ?? []),
  ];

  const value = round2(components.reduce((sum, k) => sum + k.value * k.weight, 0));
  const parts: string[] = [];
  const [pc, rc, tc, cc] = components as [ExperienceComponent, ExperienceComponent, ExperienceComponent, ExperienceComponent];
  if (pc.evidenceIds.length) parts.push(`${papers} PubMed ${plural(papers, "paper")} on ${c.diseaseName} in the retrieved set (${rc.evidenceIds.length ? recent : 0} in the last ${RECENT_YEARS} years)`);
  if (tc.evidenceIds.length) parts.push(`overall official on ${trials} recruiting ${plural(trials, "trial")}`);
  if (cc.evidenceIds.length && best) parts.push(`affiliation matches ${best.name} (${best.designation})`);
  const evidenceIds = uniqueIds(components.flatMap((k) => k.evidenceIds.map((id) => ({ id }) as EvidenceWithId)));
  return {
    value: evidenceIds.length ? value : 0,
    text: parts.length ? `Documented experience: ${parts.join("; ")}.` : "",
    evidenceIds,
    components,
  };
}
