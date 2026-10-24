/**
 * Rare-disease resource tags. Every tag is derived in code from code-stamped evidence claim types (never from model
 * prose), so the shortlist grouping, plan rules and judge input all agree on what a resource is.
 */

/** Evidence claim types stamped by code for rare-disease resource types. */
export const RARE_CLAIM_TYPES = {
  /** ClinicalTrials.gov study with study type OBSERVATIONAL (natural-history / cohort study), recruiting. */
  observationalStudy: "observational_study",
  /** A patient registry page (registry name + URL as fetched). */
  patientRegistry: "patient_registry",
  /** Listed on NORD's public Rare Disease Centers of Excellence list (as fetched). */
  nordCenterOfExcellence: "nord_center_of_excellence",
  /** An NIH Rare Diseases Clinical Research Network (RDCRN) consortium page that names this condition. */
  rdcrnConsortium: "rdcrn_consortium",
  /** NIH Undiagnosed Diseases Network intake / application page. */
  udnIntake: "udn_intake",
  /** NPPES registry listing with a medical genetics taxonomy code. */
  medicalGeneticsTaxonomy: "medical_genetics_taxonomy",
  /** Genetic testing (exome / genome) or testing financial-assistance program page. */
  geneticTestingProgram: "genetic_testing_program",
  /** Advocacy organization for people without a diagnosis (e.g. SWAN USA). */
  undiagnosedAdvocacy: "undiagnosed_advocacy",
} as const;

export type RareClaimType = (typeof RARE_CLAIM_TYPES)[keyof typeof RARE_CLAIM_TYPES];

export type RareTag =
  | "observational_study"
  | "registry"
  | "nord_coe"
  | "rdcrn"
  | "udn"
  | "genetics"
  | "testing_aid"
  | "undiagnosed_support";

const TAG_FOR_CLAIM: Readonly<Record<RareClaimType, RareTag>> = {
  observational_study: "observational_study",
  patient_registry: "registry",
  nord_center_of_excellence: "nord_coe",
  rdcrn_consortium: "rdcrn",
  udn_intake: "udn",
  medical_genetics_taxonomy: "genetics",
  genetic_testing_program: "testing_aid",
  undiagnosed_advocacy: "undiagnosed_support",
};

/** Tags for a resource, from its evidence claim types (order follows RARE_CLAIM_TYPES, no duplicates). */
export function rareTags(evidence: ReadonlyArray<{ claimType: string }>): RareTag[] {
  const claims = new Set(evidence.map((e) => e.claimType));
  return (Object.values(RARE_CLAIM_TYPES) as RareClaimType[]).filter((c) => claims.has(c)).map((c) => TAG_FOR_CLAIM[c]);
}

/** "Studies & registries": observational studies and patient registries. */
export const isStudyOrRegistry = (tags: readonly RareTag[]): boolean => tags.includes("observational_study") || tags.includes("registry");

/** "Expert center": NORD Center of Excellence, RDCRN consortium site or the Undiagnosed Diseases Network. */
export const isExpertCenter = (tags: readonly RareTag[]): boolean => tags.includes("nord_coe") || tags.includes("rdcrn") || tags.includes("udn");

/** Patient-view labels (plain, grade 6-8). Judge view may show the same words. */
export const RARE_TAG_LABELS: Readonly<Record<RareTag, string>> = {
  observational_study: "Study that follows people over time",
  registry: "Patient registry",
  nord_coe: "NORD Center of Excellence",
  rdcrn: "NIH rare disease research network",
  udn: "Undiagnosed Diseases Network",
  genetics: "Medical genetics",
  testing_aid: "Genetic testing help",
  undiagnosed_support: "Support for people without a diagnosis",
};
