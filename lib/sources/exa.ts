import { RateLimiter, SourceError, json, type Transport } from "./transport";
import { evidence, type SourceResult } from "./types";
export interface ExaPage { url: string; title?: string; text?: string; publishedDate?: string }
export class ExaClient {
  private returnedUrls = new Set<string>();
  constructor(private transport: Transport, private apiKey?: string, private limiter = new RateLimiter(3)) {}
  private async request(endpoint: string, body: unknown, key?: string) {
    const response = await this.limiter.run(() => this.transport.request({url:`https://api.exa.ai/${endpoint}`,method:"POST",headers:{"content-type":"application/json",...(this.apiKey ? {"x-api-key":this.apiKey} : {})},body,key}));
    const data = json<{results?: ExaPage[]; error?: unknown}>(response,"exa");
    if (data.error || !Array.isArray(data.results)) throw new SourceError("exa", "Invalid search/contents response");
    for (const r of data.results) {
      try { if (!["http:","https:"].includes(new URL(r.url).protocol)) throw new Error(); }
      catch { throw new SourceError("exa", "Invalid result URL"); }
    }
    return {results:data.results,fetchedAt:response.fetchedAt};
  }
  private result(pages: ExaPage[], fetchedAt: string): SourceResult<ExaPage> {
    const records = [...new Map(pages.map(p => [p.url,p])).values()];
    return {records,evidence:records.flatMap(p => { const text = p.text?.trim(); return text ? [evidence("exa",p.url,fetchedAt,"page_excerpt",text.slice(0,1000))] : []; })};
  }
  async search(query: string, options: {key?: string; numResults?: number} = {}): Promise<SourceResult<ExaPage>> {
    if (!query.trim()) throw new SourceError("exa", "Empty search query");
    const response = await this.request("search",{query,numResults:options.numResults ?? 10,contents:{text:true}},options.key);
    response.results.forEach(r => this.returnedUrls.add(r.url));
    // Search fixtures include the text fetched by Exa's contents option. Bare snippets/titles produce no evidence.
    return this.result(response.results,response.fetchedAt);
  }
  async contents(urls: string[], key?: string): Promise<SourceResult<ExaPage>> {
    if (urls.some(url => !this.returnedUrls.has(url))) throw new SourceError("exa", "Contents URL was not returned by this client's search");
    if (!urls.length) return {records:[],evidence:[]};
    const response = await this.request("contents",{urls,text:true},key);
    if (response.results.some(r => !urls.includes(r.url) || !this.returnedUrls.has(r.url))) throw new SourceError("exa", "Unexpected contents URL");
    return this.result(response.results,response.fetchedAt);
  }
}
