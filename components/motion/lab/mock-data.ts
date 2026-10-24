import type { Evidence, ScoreBreakdownItem } from "@/lib/contracts";

/** Fictional, synthetic data for the motion lab only. No real people or institutions. */

export interface LabResource {
  id: string;
  kind: "Specialist" | "Center" | "Trial" | "Advocacy" | "Aid";
  name: string;
  detail: string;
  breakdown: ScoreBreakdownItem[];
  evidence: Evidence[];
}

const FETCHED = "2026-10-20T15:04:00.000Z";

export const LAB_RESOURCES: LabResource[] = [
  {
    id: "inst-lakeshore",
    kind: "Center",
    name: "Lakeshore Sarcoma Program",
    detail: "Multidisciplinary sarcoma clinic, second-opinion intake",
    breakdown: [
      { factor: "volume", points: 34, text: "Sees many people with this diagnosis", evidenceIds: ["e1", "e2"] },
      { factor: "trials", points: 22, text: "Runs two recruiting trials", evidenceIds: ["e3"] },
      { factor: "distance", points: 12, text: "In your state", evidenceIds: ["e4"] },
      { factor: "intake", points: -4, text: "Referral required", evidenceIds: ["e5"] },
    ],
    evidence: [
      {
        claimType: "volume",
        claim: "Published 18 papers on this sarcoma subtype since 2019.",
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/?term=example",
        sourceKind: "pubmed",
        fetchedAt: FETCHED,
      },
      {
        claimType: "intake",
        claim: "Second-opinion requests are taken through the new-patient line.",
        sourceUrl: "https://example.org/lakeshore/second-opinion",
        sourceKind: "exa",
        fetchedAt: FETCHED,
      },
    ],
  },
  {
    id: "exp-okafor",
    kind: "Specialist",
    name: "Dr. Amara Okafor, MD",
    detail: "Medical oncology, soft-tissue sarcoma",
    breakdown: [
      { factor: "papers", points: 28, text: "Recent papers on this subtype", evidenceIds: ["e6", "e7"] },
      { factor: "identity", points: 16, text: "Licensed and listed in the NPI registry", evidenceIds: ["e8"] },
      { factor: "trials", points: 10, text: "Leads one recruiting trial", evidenceIds: ["e9"] },
    ],
    evidence: [
      {
        claimType: "identity",
        claim: "Listed in the NPI registry as a medical oncologist.",
        sourceUrl: "https://npiregistry.cms.hhs.gov/",
        sourceKind: "nppes",
        fetchedAt: FETCHED,
      },
    ],
  },
  {
    id: "trial-example",
    kind: "Trial",
    name: "A study of targeted therapy in advanced sarcoma",
    detail: "Recruiting, phase 2, two sites in your region",
    breakdown: [
      { factor: "status", points: 30, text: "Recruiting now", evidenceIds: ["e10"] },
      { factor: "sites", points: 14, text: "Site within your travel limit", evidenceIds: ["e11"] },
    ],
    evidence: [
      {
        claimType: "status",
        claim: "Recruitment status: recruiting.",
        sourceUrl: "https://clinicaltrials.gov/",
        sourceKind: "ctgov",
        fetchedAt: FETCHED,
      },
    ],
  },
  {
    id: "org-aid",
    kind: "Aid",
    name: "Rare Path Travel Fund",
    detail: "Covers travel to specialist appointments",
    breakdown: [
      { factor: "fit", points: 20, text: "Covers travel for second opinions", evidenceIds: ["e12"] },
      { factor: "open", points: 8, text: "Accepting applications", evidenceIds: ["e13"] },
    ],
    evidence: [
      {
        claimType: "services",
        claim: "Reimburses mileage and lodging for specialist visits.",
        sourceUrl: "https://example.org/rare-path/travel",
        sourceKind: "exa",
        fetchedAt: FETCHED,
      },
    ],
  },
];

export const LAB_WAYPOINTS = [
  { id: "specialists", label: "Specialists", count: 7 },
  { id: "trials", label: "Trials", count: 4 },
  { id: "advocacy", label: "Advocacy", count: 3 },
  { id: "aid", label: "Aid", count: 2 },
];
