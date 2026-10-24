import { RateLimiter, SourceError, json, type Transport } from "./transport";
import { evidence, type SourceResult } from "./types";
export interface NppesProvider {
  number: string; enumeration_type?: string;
  basic: { first_name?: string; last_name?: string; middle_name?: string; credential?: string; status?: string; organization_name?: string };
  addresses?: {state?: string; city?: string; address_purpose?: string; telephone_number?: string}[];
  taxonomies?: {code?: string; desc?: string; state?: string; primary?: boolean}[];
}
export interface IdentityQuery {firstName: string; lastName: string; state?: string; taxonomy?: string; affiliation?: string; key?: string; limit?: number}
export type IdentityResult = SourceResult<NppesProvider> & {status:"verified"|"ambiguous"|"not_found"; reason: string};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export class NppesClient {
  constructor(private transport: Transport, private limiter = new RateLimiter(3)) {}
  async lookup(query: IdentityQuery): Promise<IdentityResult> {
    if (!query.firstName.trim() || !query.lastName.trim()) throw new SourceError("nppes", "Both names are required");
    const limit = query.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new SourceError("nppes", "Limit must be 1..200");
    const url = new URL("https://npiregistry.cms.hhs.gov/api/");
    Object.entries({version:"2.1",first_name:query.firstName,last_name:query.lastName,limit:String(limit), ...(query.state ? {state:query.state} : {})}).forEach(([k,v]) => url.searchParams.set(k,v));
    const response = await this.limiter.run(() => this.transport.request({url:url.href,key:query.key}));
    const data = json<{result_count?: number; results?: (Omit<NppesProvider,"number"> & {number:string|number})[]; Errors?: unknown}>(response,"nppes");
    if (data.Errors || !Array.isArray(data.results) || typeof data.result_count !== "number") throw new SourceError("nppes", "Invalid registry response");
    const providers = new Map<string,NppesProvider>();
    for (const row of data.results) {
      const number = String(row.number);
      if (!/^\d{10}$/.test(number) || !row.basic) throw new SourceError("nppes", "Invalid provider record");
      providers.set(number,{...row,number});
    }
    const records = [...providers.values()];
    const taxonomy = query.taxonomy;
    const matches = records.filter(r => r.enumeration_type === "NPI-1" && r.basic.status === "A" && norm(r.basic.first_name ?? "") === norm(query.firstName) && norm(r.basic.last_name ?? "") === norm(query.lastName)
      && (!query.state || r.addresses?.some(a => a.state?.toUpperCase() === query.state?.toUpperCase()))
      && (!taxonomy || r.taxonomies?.some(t => t.code === taxonomy || norm(t.desc ?? "") === norm(taxonomy)))
      && (!query.affiliation || norm(r.basic.organization_name ?? "") === norm(query.affiliation)));
    // Name alone, truncated results, or absent corroboration must never silently verify identity.
    const actualLimit = response.requestUrl ? Number(new URL(response.requestUrl).searchParams.get("limit") ?? limit) : limit;
    const verified = matches.length === 1 && !!query.state && !!query.taxonomy && !!query.affiliation && !!matches[0].basic.organization_name && data.result_count < actualLimit;
    const selected = verified ? matches : records;
    return {status: records.length === 0 ? "not_found" : verified ? "verified" : "ambiguous",
      reason: records.length === 0 ? "No registry matches" : verified ? "Unique active individual with exact name, state, taxonomy and affiliation" : "Identity requires corroboration; no provider selected",
      records:selected,evidence:selected.map(r => evidence("nppes",`https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,response.fetchedAt,"registry_listing",`NPI ${r.number}: ${r.basic.first_name ?? ""} ${r.basic.last_name ?? ""}; ${r.basic.credential ?? "credentials not listed"}; registry details: ${JSON.stringify({addresses:r.addresses,taxonomies:r.taxonomies,organization:r.basic.organization_name})}`))};
  }
}
