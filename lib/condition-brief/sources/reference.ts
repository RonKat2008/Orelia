/**
 * Condition Brief collector: curated reference pages and prevalence.
 * Orphanet (Orphadata API, no key) gives the ORPHAcode, definition and prevalence classes; GARD, NORD,
 * GeneReviews and MedlinePlus Genetics pages come from Exa domain-restricted searches.
 * Each sub-source fails independently into `errors`; the collector itself never throws.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { cleanField, neutralizeUntrusted } from "@/lib/agents/research/untrusted";
import type { BriefSource, BriefSourceKind, Prevalence, SourceDesign } from "../contract";
import { fixtureKey, type CollectContext, type Collector } from "./types";

export const REFERENCE_FILES = {
  orphanetName: "orphanet-name.json",
  orphanetEpi: "orphanet-epi.json",
  gard: "ref-gard.json",
  nord: "ref-nord.json",
  genereviews: "ref-genereviews.json",
  medlineplus: "ref-medlineplus.json",
} as const;

export const ORPHADATA_BASE = "https://api.orphadata.com";
export const EXA_SEARCH_URL = "https://api.exa.ai/search";
const ORPHA_PAGE = "https://www.orpha.net/en/disease/detail/";
const EXCERPT_CAP = 3500;
const EXA_TEXT_CHARS = 6000;
const EXA_NUM_RESULTS = 5;
const MIN_DENOMINATOR = 1000;
const SKIPPED_PREVALENCE_CLASSES = new Set(["unknown", "not yet documented", "undetermined"]);

export function orphanetNameUrl(disease: string): string {
  return `${ORPHADATA_BASE}/rd-cross-referencing/orphacodes/names/${encodeURIComponent(disease)}`;
}
export function orphanetEpiUrl(code: number): string {
  return `${ORPHADATA_BASE}/rd-epidemiology/orphacodes/${code}`;
}

type ExaKind = "gard" | "nord" | "genereviews" | "medlineplus";
interface ExaKindSpec {
  kind: ExaKind;
  design: SourceDesign;
  publisher: string;
  domain: string;
  queryHint: string;
  file: string;
  /** Returns the source slug when the URL is a page of the expected type, else undefined. */
  slug: (url: URL) => string | undefined;
}

const lastSegment = (url: URL): string | undefined => {
  const seg = url.pathname.split("/").filter(Boolean).pop();
  const clean = seg?.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return clean || undefined;
};

export const EXA_KINDS: readonly ExaKindSpec[] = [
  {
    kind: "gard", design: "reference_page", publisher: "NIH Genetic and Rare Diseases Information Center",
    domain: "rarediseases.info.nih.gov", queryHint: "GARD rare disease", file: REFERENCE_FILES.gard,
    slug: (u) => {
      if (u.hostname !== "rarediseases.info.nih.gov") return undefined;
      const m = /^\/diseases\/(\d+)(?:\/([^/]+))?/.exec(u.pathname);
      return m ? [m[1], m[2]].filter(Boolean).join("-").toLowerCase() : undefined;
    },
  },
  {
    kind: "nord", design: "reference_page", publisher: "National Organization for Rare Disorders",
    domain: "rarediseases.org", queryHint: "NORD rare disease", file: REFERENCE_FILES.nord,
    slug: (u) => (/^(www\.)?rarediseases\.org$/.test(u.hostname) && /^\/rare-diseases\//.test(u.pathname) ? lastSegment(u) : undefined),
  },
  {
    kind: "genereviews", design: "genereviews", publisher: "GeneReviews, NCBI Bookshelf",
    domain: "ncbi.nlm.nih.gov", queryHint: "GeneReviews", file: REFERENCE_FILES.genereviews,
    slug: (u) => {
      if (!/^(www\.)?ncbi\.nlm\.nih\.gov$/.test(u.hostname)) return undefined;
      return /^\/books\/(NBK\d+)/i.exec(u.pathname)?.[1]?.toUpperCase();
    },
  },
  {
    kind: "medlineplus", design: "reference_page", publisher: "MedlinePlus Genetics, NLM",
    domain: "medlineplus.gov", queryHint: "MedlinePlus Genetics condition", file: REFERENCE_FILES.medlineplus,
    slug: (u) => (u.hostname === "medlineplus.gov" && /^\/genetics\/condition\//.test(u.pathname) ? lastSegment(u) : undefined),
  },
];

export function exaReferenceBody(disease: string, spec: Pick<ExaKindSpec, "domain" | "queryHint">) {
  return {
    query: `${disease} ${spec.queryHint}`,
    numResults: EXA_NUM_RESULTS,
    includeDomains: [spec.domain],
    contents: { text: { maxCharacters: EXA_TEXT_CHARS } },
  };
}

const exaResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string().min(1),
      title: z.string().nullish(),
      text: z.string().nullish(),
      publishedDate: z.string().nullish(),
    }).loose(),
  ),
});
export type ExaResult = z.infer<typeof exaResponseSchema>["results"][number];

/** Single Exa search through the injected transport (key only as a header, never in a URL or error). */
export async function exaSearch(
  ctx: CollectContext,
  body: unknown,
  file: string,
): Promise<{ results: ExaResult[]; fetchedAt: string }> {
  const response = await ctx.transport.request({
    url: EXA_SEARCH_URL,
    method: "POST",
    headers: { "content-type": "application/json", ...(ctx.exaApiKey ? { "x-api-key": ctx.exaApiKey } : {}) },
    body,
    key: fixtureKey(ctx, file),
  });
  const parsed = exaResponseSchema.parse(JSON.parse(response.body));
  return { results: parsed.results, fetchedAt: response.fetchedAt };
}

export function sha8(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 8);
}

export function parseHttpUrl(raw: string): URL | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u : undefined;
  } catch {
    return undefined;
  }
}

const TRAILING_GENERIC = new Set(["syndrome", "disease", "disorder"]);
const normalize = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Contiguous normalized phrase for a disease ("vascular Ehlers-Danlos syndrome" -> "vascular ehlers danlos"),
 * dropping a trailing generic word. Contiguity keeps "epithelioid hemangioendothelioma ... sarcoma" from
 * matching "epithelioid sarcoma".
 */
export function diseasePhrase(disease: string): string {
  const tokens = normalize(disease).split(" ").filter(Boolean);
  while (tokens.length > 1 && TRAILING_GENERIC.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function namesDisease(haystack: string, disease: string): boolean {
  const phrase = diseasePhrase(disease);
  return phrase.length > 0 && ` ${normalize(haystack)} `.includes(` ${phrase} `);
}

const NUM = String.raw`\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?`;
const RANGE = String.raw`(?:${NUM})(?:\s*(?:-|–|to)\s*(?:1\s*(?:in|\/)\s*)?(?:${NUM}))?`;
const PREVALENCE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b1\s*(?:in|\/|:)\s*${RANGE}(?!\d)`, "i"),
  new RegExp(String.raw`\b${RANGE}\s*(?:cases\s*|people\s*|individuals\s*|births\s*)?(?:per|\/)\s*(?:1,?000,?000|million|100,?000|10,?000|1,?000)\b`, "i"),
];

function largestNumber(s: string): number {
  const nums = s.match(/\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?/g) ?? [];
  return Math.max(0, ...nums.map((n) => Number(n.replace(/[,\s]/g, ""))));
}

/** First explicit prevalence figure in already-neutralized text, verbatim, or undefined. */
export function extractPrevalencePhrase(text: string): string | undefined {
  for (const pattern of PREVALENCE_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
      const phrase = m[0].replace(/\s+/g, " ").trim();
      // "1 in 5 patients" is not a prevalence; the population denominator must be rare-disease scale.
      const perForm = /per|\//i.test(phrase) && !/^1\s*(?:in|\/|:)/i.test(phrase);
      if (perForm || largestNumber(phrase) >= MIN_DENOMINATOR) return phrase.slice(0, 120);
    }
  }
  return undefined;
}

function yearOf(date: string | null | undefined): number | undefined {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isInteger(y) && y >= 1800 && y <= 2100 ? y : undefined;
}

const orphanetNameSchema = z.object({
  data: z.object({
    results: z.object({
      ORPHAcode: z.number().int().positive(),
      "Preferred term": z.string().optional(),
      SummaryInformation: z.array(z.object({ Definition: z.string().nullish() }).loose()).nullish(),
    }).loose(),
  }).loose(),
}).loose();

const orphanetEpiSchema = z.object({
  data: z.object({
    results: z.object({
      Prevalence: z.array(
        z.object({
          PrevalenceClass: z.string().nullish(),
          PrevalenceType: z.string().nullish(),
          PrevalenceGeographic: z.string().nullish(),
        }).loose(),
      ).nullish(),
    }).loose(),
  }).loose(),
}).loose();

type Out = { sources: BriefSource[]; prevalence: Prevalence[] };

export async function collectOrphanet(disease: string, ctx: CollectContext, errors: { source: string; message: string }[]): Promise<Out> {
  const out: Out = { sources: [], prevalence: [] };
  let code: number;
  let definition: string | undefined;
  let term: string | undefined;
  let fetchedAt: string;
  try {
    const res = await ctx.transport.request({ url: orphanetNameUrl(disease), key: fixtureKey(ctx, REFERENCE_FILES.orphanetName) });
    const r = orphanetNameSchema.parse(JSON.parse(res.body)).data.results;
    code = r.ORPHAcode;
    term = r["Preferred term"];
    definition = r.SummaryInformation?.find((s) => s.Definition)?.Definition ?? undefined;
    fetchedAt = res.fetchedAt;
  } catch {
    errors.push({ source: "orphanet", message: "Orphanet disease lookup failed" });
    return out;
  }
  const sourceId = `orphanet:ORPHA:${code}`;
  const excerpt = definition ? neutralizeUntrusted(definition).slice(0, EXCERPT_CAP) : "";
  out.sources.push({
    id: sourceId, kind: "orphanet", design: "reference_page", url: `${ORPHA_PAGE}${code}`,
    title: cleanField(term ? `${term} (ORPHA:${code})` : `ORPHA:${code}`) || `ORPHA:${code}`,
    publisher: "Orphanet", fetchedAt, excerpt: excerpt || undefined,
  });
  try {
    const res = await ctx.transport.request({ url: orphanetEpiUrl(code), key: fixtureKey(ctx, REFERENCE_FILES.orphanetEpi) });
    const rows = orphanetEpiSchema.parse(JSON.parse(res.body)).data.results.Prevalence ?? [];
    const seen = new Set<string>();
    for (const row of rows) {
      const label = cleanField(row.PrevalenceClass ?? undefined, 120);
      if (!label || SKIPPED_PREVALENCE_CLASSES.has(label.toLowerCase())) continue;
      const prevalenceType = cleanField(row.PrevalenceType ?? undefined, 80) || undefined;
      const geography = cleanField(row.PrevalenceGeographic ?? undefined, 80) || undefined;
      const dedupe = `${label}|${prevalenceType}|${geography}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.prevalence.push({ label, prevalenceType, geography, sourceId });
    }
  } catch {
    errors.push({ source: "orphanet", message: "Orphanet prevalence lookup failed" });
  }
  return out;
}

async function collectExaKind(disease: string, spec: ExaKindSpec, ctx: CollectContext): Promise<Out> {
  const out: Out = { sources: [], prevalence: [] };
  const { results, fetchedAt } = await exaSearch(ctx, exaReferenceBody(disease, spec), spec.file);
  for (const r of results) {
    const url = parseHttpUrl(r.url);
    const slug = url ? spec.slug(url) : undefined;
    if (!url || !slug) continue;
    const title = cleanField(r.title ?? undefined) ?? "";
    if (!namesDisease(title, disease)) continue;
    // NCBI Bookshelf also hosts StatPearls and other books; only GeneReviews chapters get the genereviews design.
    if (spec.kind === "genereviews" && !/genereviews/i.test(title)) continue;
    const text = neutralizeUntrusted(r.text ?? "");
    const excerpt = text.slice(0, EXCERPT_CAP);
    const id = `${spec.kind}:${slug}`;
    out.sources.push({
      id, kind: spec.kind, design: spec.design, url: url.href, title: title || disease,
      publisher: spec.publisher, year: yearOf(r.publishedDate), fetchedAt, excerpt: excerpt || undefined,
    });
    const phrase = extractPrevalencePhrase(text);
    if (phrase) out.prevalence.push({ label: phrase, sourceId: id });
    break; // top plausible page per reference site
  }
  return out;
}

export const collectReference: Collector = async (diseaseName, ctx) => {
  const errors: { source: string; message: string }[] = [];
  const sources: BriefSource[] = [];
  const prevalence: Prevalence[] = [];
  const merge = (o: Out) => { sources.push(...o.sources); prevalence.push(...o.prevalence); };

  merge(await collectOrphanet(diseaseName, ctx, errors));

  if (!ctx.offline && !ctx.exaApiKey) {
    errors.push({ source: "exa", message: "Reference page search is not configured" });
  } else {
    for (const spec of EXA_KINDS) {
      try {
        merge(await collectExaKind(diseaseName, spec, ctx));
      } catch {
        errors.push({ source: spec.kind as BriefSourceKind, message: "Reference page search failed" });
      }
    }
  }
  return { sources, prevalence, errors };
};
