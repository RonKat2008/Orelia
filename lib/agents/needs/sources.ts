/**
 * Sources for the needs analyst, built on the Condition Brief collectors (Orphanet, GARD, NORD, GeneReviews,
 * MedlinePlus, registries, PubMed reviews) instead of duplicating them, plus one live Exa search for care /
 * management pages on trusted reference and advocacy domains. Each collector is time-boxed so a slow source
 * never holds the analyst: whatever arrived by the deadline is used.
 */
import { cleanField, neutralizeUntrusted } from "@/lib/agents/research/untrusted";
import type { BriefSource, CollectedSources } from "@/lib/condition-brief/contract";
import { DEFAULT_COLLECTORS, mergeCollected } from "@/lib/condition-brief/sources";
import { exaSearch, parseHttpUrl, sha8 } from "@/lib/condition-brief/sources/reference";
import type { CollectContext, Collector, CollectorResult } from "@/lib/condition-brief/sources/types";

export const COLLECT_TIMEOUT_MS = 6_000;
const CARE_RESULTS = 6;
const CARE_TEXT_CHARS = 4000;
const CARE_EXCERPT_CAP = 2500;

/** Domains whose care/management pages the analyst may cite (reference works, NIH, major advocacy orgs). */
export const CARE_DOMAINS = [
  "ncbi.nlm.nih.gov",
  "rarediseases.org",
  "rarediseases.info.nih.gov",
  "orpha.net",
  "medlineplus.gov",
  "cancer.gov",
  "ehlers-danlos.com",
  "sarcomaalliance.org",
  "curesarcoma.org",
  "igg4ward.org",
  "nhs.uk",
] as const;

export function careSearchBody(disease: string) {
  return {
    query: `${disease} specialized care what to look for in a specialist center multidisciplinary management`,
    numResults: CARE_RESULTS,
    includeDomains: [...CARE_DOMAINS],
    contents: { text: { maxCharacters: CARE_TEXT_CHARS } },
  };
}

/** Live only: care / management pages. Offline there is no recorded fixture, so it contributes nothing. */
export const collectCare: Collector = async (diseaseName, ctx) => {
  if (ctx.offline) return {};
  if (!ctx.exaApiKey) return { errors: [{ source: "care", message: "Care search is not configured" }] };
  const { results, fetchedAt } = await exaSearch(ctx, careSearchBody(diseaseName), "needs-care.json");
  const sources: BriefSource[] = [];
  for (const r of results) {
    const url = parseHttpUrl(r.url);
    const title = cleanField(r.title ?? undefined, 400);
    if (!url || !title) continue;
    sources.push({
      id: `web:care-${sha8(url.toString())}`,
      kind: "web",
      design: "other",
      url: url.toString(),
      title,
      fetchedAt,
      excerpt: r.text ? neutralizeUntrusted(r.text).slice(0, CARE_EXCERPT_CAP) : undefined,
    });
  }
  return { sources };
};

/** Brief collectors that matter for needs; the trials/grants collector is left to the trials agent. */
export const NEEDS_COLLECTORS: Readonly<Record<string, Collector>> = {
  reference: DEFAULT_COLLECTORS.reference!,
  registries: DEFAULT_COLLECTORS.registries!,
  studies: DEFAULT_COLLECTORS.studies!,
  care: collectCare,
};

function timeBoxed(name: string, collect: Collector, ms: number): Collector {
  return async (disease, ctx) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CollectorResult>((resolve) => {
      timer = setTimeout(() => resolve({ errors: [{ source: name, message: "Source timed out" }] }), ms);
    });
    try {
      return await Promise.race([
        collect(disease, ctx).catch((): CollectorResult => ({ errors: [{ source: name, message: "Source unavailable" }] })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function collectNeedsSources(
  diseaseName: string,
  ctx: CollectContext,
  collectors: Readonly<Record<string, Collector>> = NEEDS_COLLECTORS,
  timeoutMs = COLLECT_TIMEOUT_MS,
): Promise<CollectedSources> {
  const entries = Object.entries(collectors);
  const results = await Promise.all(entries.map(([name, c]) => timeBoxed(name, c, timeoutMs)(diseaseName, ctx)));
  return mergeCollected(diseaseName, results);
}

const KIND_PRIORITY: Record<string, number> = { genereviews: 0, orphanet: 1, nord: 2, gard: 3, medlineplus: 4, web: 5, registry: 6, pubmed: 7 };

/** Sources shown to the model: reference works first, then care pages, registries and papers. */
export function promptSources(sources: readonly BriefSource[], max = 16): BriefSource[] {
  return [...sources]
    .sort((a, b) => (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, max);
}
