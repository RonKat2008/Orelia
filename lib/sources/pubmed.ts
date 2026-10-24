import type { Evidence } from "../contracts/evidence";
import { endpointOf, RateLimiter, SourceError, json, type Transport } from "./transport";
import { evidence, type SourceResult } from "./types";
import { parseXml, descendants, value } from "./xml";

export interface PubmedAuthor { name: string; firstName: string; lastName: string; affiliations: string[] }
export interface PubmedArticle { pmid: string; title: string; year: number | null; authors: PubmedAuthor[]; sourceUrl: string; fetchedAt?: string }
export interface AggregatedAuthor extends PubmedAuthor { paperCount: number; recentPaperCount: number; pmids: string[]; evidence: Evidence[] }
export function buildPubmedQuery(term: string, mesh?: string): string {
  const quote = (s: string) => `"${s.replace(/["\\]/g, " ").trim()}"`;
  if (!term.trim()) throw new SourceError("pubmed", "Empty disease query");
  return `${quote(term)}[tiab]${mesh ? ` OR ${quote(mesh)}[MeSH Terms]` : ""}`;
}
export function parsePubmedXml(xml: string): PubmedArticle[] {
  let root;
  try { root = parseXml(xml); } catch { throw new SourceError("pubmed", "Invalid XML response"); }
  const error = value(root, "ERROR");
  if (error) throw new SourceError("pubmed", error);
  if (!descendants(root, "PubmedArticleSet").length) throw new SourceError("pubmed", "Missing article set");
  // Book chapters use a different schema and are deliberately excluded from journal counts.
  return descendants(root, "PubmedArticle").map(node => {
    const pmid = value(node, "PMID");
    if (!/^\d+$/.test(pmid)) throw new SourceError("pubmed", "Invalid PMID");
    const pubdate = descendants(node, "PubDate")[0];
    const yearString = pubdate ? value(pubdate, "Year") || value(pubdate, "MedlineDate").match(/\d{4}/)?.[0] : undefined;
    return { pmid, title: value(node, "ArticleTitle"), year: yearString ? Number(yearString) : null,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      authors: descendants(node, "Author").map(author => ({
        firstName: value(author, "ForeName") || value(author, "Initials"), lastName: value(author, "LastName"),
        name: value(author, "CollectiveName") || [value(author, "ForeName") || value(author, "Initials"), value(author, "LastName")].filter(Boolean).join(" "),
        affiliations: descendants(author, "Affiliation").map(a => a.text.trim().replace(/\s+/g, " ")),
      })),
    };
  });
}
export function aggregateAuthors(articles: PubmedArticle[], now: Date): AggregatedAuthor[] {
  if (!Number.isFinite(now.getTime())) throw new SourceError("pubmed", "Invalid current date");
  const authors = new Map<string, AggregatedAuthor>();
  const since = now.getUTCFullYear() - 5;
  for (const article of articles) for (const author of article.authors) {
    if (!author.lastName) continue;
    // Bibliographic groups only: identical names are not a verified clinician identity.
    const key = `${author.lastName}|${author.firstName}`.toLowerCase();
    const item = authors.get(key) ?? { ...author, affiliations: [], paperCount: 0, recentPaperCount: 0, pmids: [], evidence: [] };
    item.affiliations = [...new Set([...item.affiliations, ...author.affiliations])].sort();
    if (!item.pmids.includes(article.pmid)) {
      item.pmids.push(article.pmid); item.paperCount++;
      if (article.year !== null && article.year >= since && article.year <= now.getUTCFullYear()) item.recentPaperCount++;
      if (article.fetchedAt) item.evidence.push(evidence("pubmed",article.sourceUrl,article.fetchedAt,"authorship",`${author.name} is listed as an author of ${article.title}${author.affiliations.length ? `; listed affiliations: ${author.affiliations.join("; ")}` : ""}`));
    }
    authors.set(key, item);
  }
  return [...authors.values()].sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
export class PubMedClient {
  private limiter: RateLimiter;
  constructor(private transport: Transport, private options: {apiKey?: string; limiter?: RateLimiter} = {}) {
    this.limiter = options.limiter ?? new RateLimiter(options.apiKey ? 10 : 3);
  }
  private async get(endpoint: string, params: Record<string,string>, key?: string) {
    const url = new URL(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${endpoint}.fcgi`);
    Object.entries({...params, ...(this.options.apiKey ? {api_key: this.options.apiKey} : {})}).forEach(([k,v]) => url.searchParams.set(k,v));
    return this.limiter.run(() => this.transport.request({url: url.href, key}));
  }
  async search(term: string, options: {mesh?: string; retstart?: number; retmax?: number; key?: string} = {}) {
    const response = await this.get("esearch", {db:"pubmed",term:buildPubmedQuery(term, options.mesh),retmode:"json",retstart:String(options.retstart ?? 0),retmax:String(options.retmax ?? 50)}, options.key);
    const data = json<{error?: string; esearchresult?: {count: string; retstart: string; retmax: string; idlist: string[]; ERROR?: string}}>(response,"pubmed");
    const result = data.esearchresult;
    if (data.error || result?.ERROR || !result || !Array.isArray(result.idlist) || !/^\d+$/.test(result.count)) throw new SourceError("pubmed", "Invalid search response");
    return {ids: result.idlist, count: Number(result.count), retstart: Number(result.retstart), retmax: Number(result.retmax), fetchedAt: response.fetchedAt};
  }
  async fetch(ids: string[], key?: string): Promise<SourceResult<PubmedArticle>> {
    if (!ids.length) return {records: [], evidence: []};
    if (!ids.every(id => /^\d+$/.test(id))) throw new SourceError("pubmed", "Invalid PMID");
    const response = await this.get("efetch",{db:"pubmed",id:ids.join(","),retmode:"xml"},key);
    if (response.status >= 400) throw new SourceError("pubmed", `HTTP ${response.status} ${response.requestUrl ? endpointOf(response.requestUrl) : "unknown-endpoint"}`, response.status);
    const records = parsePubmedXml(response.body).filter(r => ids.includes(r.pmid)).map(r => ({...r,fetchedAt:response.fetchedAt}));
    return {records, evidence: records.map(a => evidence("pubmed",a.sourceUrl,response.fetchedAt,"publication",`${a.title} (${a.year ?? "year unknown"}); authors: ${a.authors.map(x => x.name).join(", ")}`))};
  }
}
