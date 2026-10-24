/**
 * Condition Brief collector: PubMed reviews + recent literature -> BriefSource (kind "pubmed") + StudyItem.
 * Never throws for a failed sub-source; failures go to `errors` with generic messages (no URLs, no keys).
 */
import { z } from "zod";
import { neutralizeUntrusted } from "@/lib/agents/research/untrusted";
import { descendants, parseXml, value, type XmlNode } from "@/lib/sources/xml";
import type { BriefSource, StudyItem } from "../contract";
import { designCeiling, pubmedDesign } from "./design";
import { fixtureKey, type CollectContext, type Collector, type CollectorResult } from "./types";

export const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
export const PUBMED_FILES = {
  reviews: "pubmed-esearch-reviews.json",
  recent: "pubmed-esearch-recent.json",
  efetch: "pubmed-efetch.xml",
} as const;
const REVIEW_RETMAX = 8;
const RECENT_RETMAX = 6;
const RECENT_YEARS = 3;
const ABSTRACT_CAP = 3500;
const TITLE_CAP = 400;
const REVIEW_FILTER =
  "(review[pt] OR systematic review[pt] OR meta-analysis[pt] OR guideline[pt] OR practice guideline[pt] OR consensus development conference[pt])";

const esearchSchema = z.object({
  esearchresult: z.object({ idlist: z.array(z.string().regex(/^\d+$/)) }).loose(),
});

const quote = (disease: string) => `"${disease.replace(/["\\]/g, " ").trim()}"`;

function eutilsUrl(endpoint: "esearch" | "efetch", params: Record<string, string>, ctx: CollectContext): string {
  const url = new URL(`${EUTILS_BASE}/${endpoint}.fcgi`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("tool", "wayfinder");
  url.searchParams.set("email", "dev@example.com");
  if (ctx.ncbiApiKey) url.searchParams.set("api_key", ctx.ncbiApiKey);
  return url.href;
}

export function reviewsSearchUrl(disease: string, ctx: CollectContext): string {
  return eutilsUrl("esearch", {
    db: "pubmed",
    term: `${quote(disease)}[tiab] AND ${REVIEW_FILTER}`,
    retmode: "json",
    retmax: String(REVIEW_RETMAX),
    sort: "relevance",
  }, ctx);
}

export function recentSearchUrl(disease: string, ctx: CollectContext): string {
  const year = ctx.now.getUTCFullYear();
  return eutilsUrl("esearch", {
    db: "pubmed",
    term: `${quote(disease)}[tiab]`,
    retmode: "json",
    retmax: String(RECENT_RETMAX),
    sort: "pub_date",
    datetype: "pdat",
    mindate: String(year - RECENT_YEARS),
    maxdate: String(year),
  }, ctx);
}

export function efetchUrl(ids: string[], ctx: CollectContext): string {
  return eutilsUrl("efetch", { db: "pubmed", id: ids.join(","), retmode: "xml" }, ctx);
}

export interface ParsedPubmedArticle {
  pmid: string;
  title: string;
  journal?: string;
  year?: number;
  publicationTypes: string[];
  abstract: string;
}

function yearOf(node: XmlNode): number | undefined {
  const pubDate = descendants(node, "PubDate")[0];
  const raw = pubDate ? value(pubDate, "Year") || value(pubDate, "MedlineDate").match(/\d{4}/)?.[0] : undefined;
  const articleDate = descendants(node, "ArticleDate")[0];
  const fallback = articleDate ? value(articleDate, "Year") : "";
  const n = Number(raw || fallback);
  return Number.isInteger(n) && n >= 1800 && n <= 2100 ? n : undefined;
}

/** Parse efetch XML (PubmedArticle records only; Bookshelf chapters are skipped). Throws on malformed XML. */
export function parsePubmedArticles(xml: string): ParsedPubmedArticle[] {
  const root = parseXml(xml);
  const out: ParsedPubmedArticle[] = [];
  for (const node of descendants(root, "PubmedArticle")) {
    const citation = descendants(node, "MedlineCitation")[0] ?? node;
    const pmid = citation.children.find((c) => c.name === "PMID")?.text.trim() ?? "";
    if (!/^\d+$/.test(pmid)) continue;
    const title = value(node, "ArticleTitle");
    if (!title) continue;
    const journalNode = descendants(node, "Journal")[0];
    const journal = journalNode ? value(journalNode, "Title") : "";
    const types = descendants(node, "PublicationType").map((t) => t.text.trim().replace(/\s+/g, " ")).filter(Boolean);
    const abstract = descendants(node, "AbstractText").map((t) => t.text.trim().replace(/\s+/g, " ")).filter(Boolean).join(" ");
    out.push({ pmid, title, journal: journal || undefined, year: yearOf(node), publicationTypes: types, abstract });
  }
  return out;
}

async function searchIds(url: string, file: string, ctx: CollectContext): Promise<string[]> {
  const res = await ctx.transport.request({ url, key: fixtureKey(ctx, file) });
  return esearchSchema.parse(JSON.parse(res.body)).esearchresult.idlist;
}

function toRecords(a: ParsedPubmedArticle, kind: StudyItem["kind"], fetchedAt: string): { source: BriefSource; study: StudyItem } {
  const design = pubmedDesign(a.publicationTypes);
  const title = neutralizeUntrusted(a.title).slice(0, TITLE_CAP) || `PubMed ${a.pmid}`;
  const journal = a.journal ? neutralizeUntrusted(a.journal).slice(0, 200) : undefined;
  const excerpt = a.abstract ? neutralizeUntrusted(a.abstract).slice(0, ABSTRACT_CAP) : undefined;
  const sourceId = `pubmed:${a.pmid}`;
  return {
    source: {
      id: sourceId,
      kind: "pubmed",
      design,
      url: `https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`,
      title,
      publisher: journal || undefined,
      year: a.year,
      fetchedAt,
      excerpt: excerpt || undefined,
    },
    study: {
      sourceId,
      pmid: a.pmid,
      title,
      journal: journal || undefined,
      year: a.year,
      publicationTypes: a.publicationTypes.slice(0, 12).map((t) => t.slice(0, 80)),
      kind,
      evidenceLevel: designCeiling(design),
    },
  };
}

export const collectStudies: Collector = async (diseaseName, ctx) => {
  const errors: { source: string; message: string }[] = [];
  const result: CollectorResult = { sources: [], studies: [], errors };

  const settled = await Promise.allSettled([
    searchIds(reviewsSearchUrl(diseaseName, ctx), PUBMED_FILES.reviews, ctx),
    searchIds(recentSearchUrl(diseaseName, ctx), PUBMED_FILES.recent, ctx),
  ]);
  const [reviews, recent] = settled;
  if (reviews.status === "rejected") errors.push({ source: "pubmed", message: "PubMed review search unavailable" });
  if (recent.status === "rejected") errors.push({ source: "pubmed", message: "PubMed recent-literature search unavailable" });

  const reviewIds = reviews.status === "fulfilled" ? reviews.value : [];
  const recentIds = recent.status === "fulfilled" ? recent.value : [];
  const kinds = new Map<string, StudyItem["kind"]>();
  for (const id of recentIds) kinds.set(id, "recent");
  for (const id of reviewIds) kinds.set(id, "review");
  const ids = [...new Set([...reviewIds, ...recentIds])];
  if (ids.length === 0) return result;

  try {
    const res = await ctx.transport.request({ url: efetchUrl(ids, ctx), key: fixtureKey(ctx, PUBMED_FILES.efetch) });
    const byPmid = new Map(parsePubmedArticles(res.body).map((a) => [a.pmid, a]));
    for (const id of ids) {
      const article = byPmid.get(id);
      if (!article) continue;
      const rec = toRecords(article, kinds.get(id) ?? "recent", res.fetchedAt);
      result.sources!.push(rec.source);
      result.studies!.push(rec.study);
    }
  } catch {
    errors.push({ source: "pubmed", message: "PubMed article fetch unavailable" });
  }
  return result;
};
