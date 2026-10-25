import {
  evidenceSchema,
  ORGANIZATION_KINDS,
  resourceSchema,
  scoreBreakdownItemSchema,
  type Evidence,
  type Resource,
} from "@/lib/contracts";
import { isStudyOrRegistry, rareTags } from "@/lib/rare-disease/tags";
import { z } from "zod";

export const tierSchema = z.enum(["best", "good", "backup", "exclude"]);

export const tierReasonSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(z.string()),
});

export const shortlistCardSchema = z.object({
  resource: resourceSchema,
  score: z.number(),
  breakdown: z.array(scoreBreakdownItemSchema),
  evidence: z.array(evidenceSchema),
  group: z.enum(["specialists", "studies", "trials", "advocacy", "aid"]),
  tier: tierSchema.optional(),
  tierReasons: z.array(tierReasonSchema).optional(),
});

export type ShortlistCard = z.infer<typeof shortlistCardSchema> & {
  /** Case candidate row id. Consent and outreach select this, not the resource id. */
  caseCandidateId?: string | null;
};

export function selectionKey(card: ShortlistCard): string {
  return card.caseCandidateId || card.resource.id;
}

const fetchedAt = "2026-10-23T12:00:00.000Z";

function evidence(
  partial: Pick<Evidence, "claimType" | "claim" | "sourceUrl" | "sourceKind">,
): Evidence {
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
        sourceUrl:
          "https://www.cancer.gov/research/infrastructure/cancer-centers/find",
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
        sourceUrl:
          "https://www.cancer.gov/research/infrastructure/cancer-centers/find",
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

/**
 * "Studies & registries" holds observational studies and patient registries, kept apart from interventional trials.
 * Code-stamped claim types decide it (rareTags); the contract's studyType and registry kind agree with them.
 */
export function groupOf(
  resource: Resource,
  evidence: readonly { claimType: string }[] = [],
): ShortlistCard["group"] {
  if (resource.kind === "expert" || resource.kind === "institution")
    return "specialists";
  if (isStudyOrRegistry(rareTags(evidence))) return "studies";
  if (resource.kind === "trial")
    return resource.studyType === "observational" ? "studies" : "trials";
  if (resource.organizationKind === "registry") return "studies";
  if (resource.organizationKind === "advocacy") return "advocacy";
  return "aid";
}

const shortlistRowSchema = z.object({
  resource: resourceSchema,
  score: z.number(),
  breakdown: z.array(scoreBreakdownItemSchema),
  evidence: z.array(evidenceSchema),
  tier: tierSchema.optional(),
  tierReasons: z.array(tierReasonSchema).optional(),
});

export const shortlistResponseSchema = z.object({
  items: z.array(shortlistRowSchema),
  curationSummary: z.string().optional(),
  suggested: z.array(z.string()).optional(),
});

export type ShortlistPayload = {
  items: ShortlistCard[];
  curationSummary: string | null;
  suggested: string[];
};

const apiItemSchema = z.object({
  targetKind: z.enum(["expert", "institution", "trial", "organization"]),
  targetId: z.string().min(1),
  name: z.string().min(1),
  score: z.number(),
  breakdown: z.array(scoreBreakdownItemSchema),
  evidence: z.array(z.unknown()),
  tier: tierSchema.optional(),
  tierReasons: z.array(tierReasonSchema).optional(),
  caseCandidateId: z.string().nullable().optional(),
  nctId: z.string().nullable().optional(),
  organizationKind: z.enum(ORGANIZATION_KINDS).nullable().optional(),
});

const apiResponseSchema = z.object({
  groups: z.record(z.string(), z.array(apiItemSchema)),
  curationSummary: z.string().nullish(),
  suggested: z.array(z.object({ targetId: z.string() })).optional(),
});

function organizationKindOf(
  evidence: Evidence[],
): "advocacy" | "financial_aid" | "travel_aid" | "registry" {
  const types = evidence.map((item) => item.claimType);
  if (types.includes("patient_registry")) return "registry";
  if (types.some((type) => type.includes("travel"))) return "travel_aid";
  if (types.some((type) => type.includes("aid"))) return "financial_aid";
  return "advocacy";
}

/**
 * The live route returns slim rows (name, score, evidence) rather than full resources.
 * Rebuild just enough of a Resource for display; kind-specific detail the route does not carry stays absent.
 */
function resourceFromApiRow(
  row: z.infer<typeof apiItemSchema>,
  evidence: Evidence[],
): Resource {
  const base = {
    id: row.targetId,
    evidenceRefs: evidence.flatMap((item) => (item.id ? [item.id] : [])),
  };
  if (row.targetKind === "expert")
    return resourceSchema.parse({ ...base, kind: "expert", name: row.name });
  if (row.targetKind === "institution")
    return resourceSchema.parse({
      ...base,
      kind: "institution",
      name: row.name,
    });
  if (row.targetKind === "trial") {
    const nct = row.nctId
      ?? evidence.map((item) => /NCT\d{8}/i.exec(item.sourceUrl)?.[0]).find(Boolean);
    return resourceSchema.parse({
      ...base,
      kind: "trial",
      title: row.name,
      nctId: nct?.toUpperCase() ?? row.targetId,
    });
  }
  return resourceSchema.parse({
    ...base,
    kind: "organization",
    name: row.name,
    organizationKind: row.organizationKind ?? organizationKindOf(evidence),
  });
}

function normalizeApiShortlist(value: unknown): ShortlistPayload | null {
  const parsed = apiResponseSchema.safeParse(value);
  if (!parsed.success) return null;
  const items: ShortlistCard[] = [];
  for (const rows of Object.values(parsed.data.groups)) {
    for (const row of rows) {
      const evidence = row.evidence.flatMap((raw) => {
        const result = evidenceSchema.safeParse(raw);
        return result.success ? [result.data] : [];
      });
      try {
        const resource = resourceFromApiRow(row, evidence);
        items.push({
          resource,
          score: row.score,
          breakdown: row.breakdown,
          evidence,
          group: groupOf(resource, evidence),
          tier: row.tier,
          tierReasons: row.tierReasons,
          caseCandidateId: row.caseCandidateId ?? null,
        });
      } catch {
        // A row that cannot be shown with a source is dropped, never guessed.
      }
    }
  }
  const byTarget = new Map(items.map((item) => [item.resource.id, item]));
  const suggested = (parsed.data.suggested ?? [])
    .flatMap((pick) => {
      const card = byTarget.get(pick.targetId);
      return card ? [selectionKey(card)] : [];
    })
    .filter((id, index, all) => all.indexOf(id) === index);
  return {
    items,
    curationSummary: parsed.data.curationSummary ?? null,
    suggested,
  };
}

export function normalizeShortlist(value: unknown): ShortlistPayload | null {
  const parsed = shortlistResponseSchema.safeParse(value);
  if (!parsed.success) return normalizeApiShortlist(value);
  const items = parsed.data.items.map((item) => ({
    ...item,
    group: groupOf(item.resource, item.evidence),
  }));
  const known = new Set(items.map((item) => item.resource.id));
  return {
    items,
    curationSummary: parsed.data.curationSummary ?? null,
    suggested: (parsed.data.suggested ?? []).filter(
      (id, index, all) => known.has(id) && all.indexOf(id) === index,
    ),
  };
}

export type ShortlistBands = {
  curated: boolean;
  best: ShortlistCard[];
  listed: ShortlistCard[];
  excluded: ShortlistCard[];
};

/** Older shortlists have no tier. Those stay in one ranked list. */
export function bandShortlist(cards: ShortlistCard[]): ShortlistBands {
  const curated = cards.some((card) => card.tier !== undefined);
  if (!curated)
    return { curated: false, best: [], listed: cards, excluded: [] };
  return {
    curated: true,
    best: cards.filter((card) => card.tier === "best"),
    listed: cards.filter(
      (card) => card.tier !== "best" && card.tier !== "exclude",
    ),
    excluded: cards.filter((card) => card.tier === "exclude"),
  };
}

export function evidenceForReason(
  card: ShortlistCard,
  evidenceIds: string[],
): Evidence[] {
  const wanted = new Set(evidenceIds);
  return card.evidence.filter(
    (item) => item.id !== undefined && wanted.has(item.id),
  );
}

/** A saved choice wins. Otherwise pre-check the curator's suggestions, capped at the contact limit. */
export function initialSelection(
  stored: string[] | null,
  suggested: string[],
  limit: number,
): string[] {
  const source = stored ?? suggested;
  return source
    .filter((id, index) => source.indexOf(id) === index)
    .slice(0, limit);
}

/**
 * One-click "Pick the top N": the curator's suggestions first, then the best-scoring cards that are not excluded,
 * never more than the limit. Pure, so the judge can see exactly who it picked in the list.
 */
export function topPicks(items: ShortlistCard[], suggested: string[], limit: number): string[] {
  const keys = new Set(items.map(selectionKey));
  const ranked = items
    .filter((card) => card.tier !== "exclude")
    .sort((a, b) => b.score - a.score)
    .map(selectionKey);
  const order = [...suggested.filter((id) => keys.has(id)), ...ranked];
  return order.filter((id, index) => order.indexOf(id) === index).slice(0, limit);
}

/** Suggestions shown as ticked must be stored like a click, or consent opens with nobody selected. */
export function shouldPersistInitialSelection(stored: string[] | null, initial: string[]): boolean {
  return stored === null && initial.length > 0;
}

const emptyShortlist: ShortlistPayload = { items: [], curationSummary: null, suggested: [] };

function offlinePreview(): boolean {
  const raw = process.env.NEXT_PUBLIC_WAYFINDER_OFFLINE ?? "";
  return ["1", "true"].includes(raw.trim().toLowerCase());
}

export async function loadShortlist(
  caseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ payload: ShortlistPayload; preview: boolean; error: string | null }> {
  try {
    const response = await fetchImpl(`/api/cases/${caseId}/shortlist`);
    if (response.ok) {
      const payload = normalizeShortlist(await response.json());
      if (payload) return { payload, preview: false, error: null };
      return { payload: emptyShortlist, preview: false, error: "The shortlist came back in an unexpected shape." };
    }
    if (offlinePreview()) {
      return { payload: { items: previewShortlist, curationSummary: null, suggested: [] }, preview: true, error: null };
    }
    return { payload: emptyShortlist, preview: false, error: "The shortlist could not be loaded." };
  } catch {
    if (offlinePreview()) {
      return { payload: { items: previewShortlist, curationSummary: null, suggested: [] }, preview: true, error: null };
    }
    return { payload: emptyShortlist, preview: false, error: "The shortlist could not be loaded." };
  }
}

/** Home state from the case, used by the in-state filter. Absent or failed reads simply leave the filter unavailable. */
export async function loadHomeState(caseId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/cases/${caseId}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { case?: { homeState?: unknown } };
    const state = body.case?.homeState;
    return typeof state === "string" && state.trim() ? state.trim() : null;
  } catch {
    return null;
  }
}

export type OrderPreview = Record<string, number>;

/** Re-rank preview from the existing ranking API: target id -> rank. Never changes the saved shortlist. */
export async function previewOrder(
  caseId: string,
  weights: Record<string, number>,
): Promise<OrderPreview> {
  const response = await fetch("/api/ranking/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caseId, weights }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    candidates?: { targetId: string; rank: number }[];
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Preview ranking is unavailable.");
  return Object.fromEntries(
    (payload.candidates ?? []).map((row) => [row.targetId, row.rank]),
  );
}

export function orderByPreview(
  cards: ShortlistCard[],
  preview: OrderPreview | null,
): ShortlistCard[] {
  if (!preview) return cards;
  return [...cards].sort(
    (a, b) =>
      (preview[a.resource.id] ?? Number.MAX_SAFE_INTEGER) -
      (preview[b.resource.id] ?? Number.MAX_SAFE_INTEGER),
  );
}
