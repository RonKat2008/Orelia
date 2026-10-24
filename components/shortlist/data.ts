import { evidenceSchema, resourceSchema, scoreBreakdownItemSchema, type Evidence, type Resource } from "@/lib/contracts";
import { z } from "zod";

export const shortlistCardSchema = z.object({
  resource: resourceSchema,
  score: z.number(),
  breakdown: z.array(scoreBreakdownItemSchema),
  evidence: z.array(evidenceSchema),
  group: z.enum(["specialists", "trials", "advocacy", "aid"]),
});

export type ShortlistCard = z.infer<typeof shortlistCardSchema>;

const fetchedAt = "2026-10-23T12:00:00.000Z";

function evidence(partial: Pick<Evidence, "claimType" | "claim" | "sourceUrl" | "sourceKind">): Evidence {
  return evidenceSchema.parse({ ...partial, fetchedAt });
}

export const previewShortlist: ShortlistCard[] = [
  {
    group: "specialists",
    score: 42,
    resource: resourceSchema.parse({
      kind: "expert",
      id: "expert-preview-1",
      name: "Preview specialist",
      specialty: "Sarcoma",
      credentials: "MD",
      evidenceRefs: ["ev-papers"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "subtypeExpertise",
        points: 24,
        text: "Published case series on this disease subtype.",
        evidenceIds: ["ev-papers"],
      }),
      scoreBreakdownItemSchema.parse({
        factor: "institutionalFit",
        points: 18,
        text: "Practices at an NCI-designated cancer center.",
        evidenceIds: ["ev-center"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "publication",
        claim: "PubMed record used as a source link in the preview.",
        sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/",
        sourceKind: "pubmed",
      }),
      evidence({
        claimType: "designation",
        claim: "NCI cancer centers directory.",
        sourceUrl: "https://www.cancer.gov/research/infrastructure/cancer-centers/find",
        sourceKind: "nci",
      }),
    ],
  },
  {
    group: "specialists",
    score: 30,
    resource: resourceSchema.parse({
      kind: "institution",
      id: "center-preview-1",
      name: "Preview cancer center",
      institutionKind: "cancer_center",
      city: "Houston",
      state: "TX",
      evidenceRefs: ["ev-center"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "access",
        points: 16,
        text: "Within the travel limit saved on the case.",
        evidenceIds: ["ev-center"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "designation",
        claim: "Center listing on the NCI find-a-center page.",
        sourceUrl: "https://www.cancer.gov/research/infrastructure/cancer-centers/find",
        sourceKind: "nci",
      }),
    ],
  },
  {
    group: "trials",
    score: 28,
    resource: resourceSchema.parse({
      kind: "trial",
      id: "trial-preview-1",
      nctId: "NCT00000000",
      title: "Preview recruiting study",
      status: "RECRUITING",
      evidenceRefs: ["ev-trial"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "subtypeExpertise",
        points: 20,
        text: "Recruiting study whose condition matches the disease name.",
        evidenceIds: ["ev-trial"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "trial",
        claim: "ClinicalTrials.gov study record.",
        sourceUrl: "https://clinicaltrials.gov/",
        sourceKind: "ctgov",
      }),
    ],
  },
  {
    group: "trials",
    score: 21,
    resource: resourceSchema.parse({
      kind: "trial",
      id: "trial-preview-2",
      nctId: "NCT00000001",
      title: "Preview observational study",
      status: "RECRUITING",
      evidenceRefs: ["ev-trial-2"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "access",
        points: 14,
        text: "A second recruiting study, so the five-resource cap can be checked.",
        evidenceIds: ["ev-trial-2"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "trial",
        claim: "Second ClinicalTrials.gov study record.",
        sourceUrl: "https://clinicaltrials.gov/study/NCT00000001",
        sourceKind: "ctgov",
      }),
    ],
  },
  {
    group: "advocacy",
    score: 18,
    resource: resourceSchema.parse({
      kind: "organization",
      id: "advocacy-preview-1",
      name: "Preview advocacy group",
      organizationKind: "advocacy",
      url: "https://rarediseases.org/",
      evidenceRefs: ["ev-advocacy"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "contactability",
        points: 10,
        text: "Public organization page with a contact path.",
        evidenceIds: ["ev-advocacy"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "organization",
        claim: "Organization page returned by search.",
        sourceUrl: "https://rarediseases.org/",
        sourceKind: "exa",
      }),
    ],
  },
  {
    group: "aid",
    score: 16,
    resource: resourceSchema.parse({
      kind: "organization",
      id: "aid-preview-1",
      name: "Preview travel aid fund",
      organizationKind: "travel_aid",
      url: "https://www.cancer.gov/",
      evidenceRefs: ["ev-aid"],
    }),
    breakdown: [
      scoreBreakdownItemSchema.parse({
        factor: "access",
        points: 12,
        text: "Program page describes travel assistance.",
        evidenceIds: ["ev-aid"],
      }),
    ],
    evidence: [
      evidence({
        claimType: "aid",
        claim: "Program page describing assistance.",
        sourceUrl: "https://www.cancer.gov/",
        sourceKind: "exa",
      }),
    ],
  },
];

export function groupOf(resource: Resource): ShortlistCard["group"] {
  if (resource.kind === "expert" || resource.kind === "institution") return "specialists";
  if (resource.kind === "trial") return "trials";
  if (resource.organizationKind === "advocacy") return "advocacy";
  return "aid";
}

export const shortlistResponseSchema = z.object({
  items: z.array(
    z.object({
      resource: resourceSchema,
      score: z.number(),
      breakdown: z.array(scoreBreakdownItemSchema),
      evidence: z.array(evidenceSchema),
    }),
  ),
});

export function normalizeShortlist(value: unknown): ShortlistCard[] | null {
  const parsed = shortlistResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.items.map((item) => ({ ...item, group: groupOf(item.resource) }));
}

export async function loadShortlist(caseId: string): Promise<{ items: ShortlistCard[]; preview: boolean }> {
  try {
    const response = await fetch(`/api/cases/${caseId}/shortlist`);
    if (response.ok) {
      const items = normalizeShortlist(await response.json());
      if (items) return { items, preview: false };
    }
  } catch {
    // Research API is owned by another task and may be absent.
  }
  return { items: previewShortlist, preview: true };
}
