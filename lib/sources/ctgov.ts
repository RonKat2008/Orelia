import { RateLimiter, SourceError, json, type Transport } from "./transport";
import { evidence, type SourceResult } from "./types";
export interface TrialContact { name?: string; role?: string; phone?: string; phoneExt?: string; email?: string }
export interface TrialSite { facility?: string; status?: string; city?: string; state?: string; country?: string; zip?: string; contacts?: TrialContact[] }
export type StudyType = "interventional" | "observational";
export interface RecruitingTrial { nctId: string; title: string; status: string; phases: string[]; sponsor?: string;
  /** designModule.studyType, lower-cased; undefined when the registry gives another value (e.g. EXPANDED_ACCESS). */
  studyType?: StudyType; investigators: TrialContact[]; contacts: TrialContact[]; sites: TrialSite[]; sourceUrl: string;
  /** Registry fields used for relevance/age filtering (additive; empty when the registry omits them). */
  conditions: string[]; keywords: string[]; meshTerms: string[]; stdAges: string[]; minimumAge?: string; maximumAge?: string }
interface Study { derivedSection?: {conditionBrowseModule?: {meshes?: {term?: string}[]}}; protocolSection?: {
  identificationModule?: {nctId?: string; briefTitle?: string; officialTitle?: string};
  statusModule?: {overallStatus?: string}; designModule?: {phases?: string[]; studyType?: string};
  sponsorCollaboratorsModule?: {leadSponsor?: {name?: string}};
  conditionsModule?: {conditions?: string[]; keywords?: string[]};
  eligibilityModule?: {stdAges?: string[]; minimumAge?: string; maximumAge?: string};
  contactsLocationsModule?: {overallOfficials?: TrialContact[]; centralContacts?: TrialContact[]; locations?: TrialSite[]};
} }
type QueryOptions = {pageSize?: number; keys?: string[]; maxPages?: number};
/** CT.gov API v2 Essie filter for observational (natural history / cohort / registry) studies. */
export const OBSERVATIONAL_FILTER = "AREA[StudyType]OBSERVATIONAL";
const toStudyType = (raw: string | undefined): StudyType | undefined =>
  raw === "OBSERVATIONAL" ? "observational" : raw === "INTERVENTIONAL" ? "interventional" : undefined;
export class CtgovClient {
  constructor(private transport: Transport, private limiter = new RateLimiter(3)) {}
  async recruitingStudies(disease: string, options: QueryOptions = {}): Promise<SourceResult<RecruitingTrial>> {
    return this.query(disease, options, {});
  }
  /** Recruiting OBSERVATIONAL studies only (filter.advanced=AREA[StudyType]OBSERVATIONAL, verified against the live API). */
  async observationalStudies(disease: string, options: QueryOptions = {}): Promise<SourceResult<RecruitingTrial>> {
    const result = await this.query(disease, options, {"filter.advanced": OBSERVATIONAL_FILTER});
    const keep = new Set(result.records.filter(r => r.studyType === "observational").map(r => r.nctId));
    return {records: result.records.filter(r => keep.has(r.nctId)), evidence: result.evidence.filter(e => [...keep].some(id => e.sourceUrl.endsWith(`/${id}`)))};
  }
  private async query(disease: string, options: QueryOptions, extra: Record<string, string>): Promise<SourceResult<RecruitingTrial>> {
    if (!disease.trim()) throw new SourceError("ctgov", "Empty disease query");
    const records = new Map<string, RecruitingTrial>();
    const claims = new Map<string, ReturnType<typeof evidence>>();
    const seen = new Set<string>();
    let token: string | undefined;
    for (let page = 0; page < (options.maxPages ?? 100); page++) {
      const url = new URL("https://clinicaltrials.gov/api/v2/studies");
      url.searchParams.set("query.cond",disease); url.searchParams.set("filter.overallStatus","RECRUITING");
      Object.entries(extra).forEach(([k,v]) => url.searchParams.set(k,v));
      url.searchParams.set("pageSize",String(options.pageSize ?? 20));
      if (token) url.searchParams.set("pageToken",token);
      const response = await this.limiter.run(() => this.transport.request({url:url.href,key:options.keys?.[page]}));
      const data = json<{studies?: Study[]; nextPageToken?: string; message?: string}>(response,"ctgov");
      if (!Array.isArray(data.studies)) throw new SourceError("ctgov", "Missing studies array");
      for (const study of data.studies) {
        const p = study.protocolSection;
        const id = p?.identificationModule?.nctId;
        if (!id || !/^NCT\d{8}$/.test(id)) throw new SourceError("ctgov", "Invalid study identifier");
        if (p?.statusModule?.overallStatus !== "RECRUITING") continue;
        const r: RecruitingTrial = {nctId:id,title:p.identificationModule?.briefTitle ?? p.identificationModule?.officialTitle ?? id,status:"RECRUITING",phases:p.designModule?.phases ?? [],studyType:toStudyType(p.designModule?.studyType),sponsor:p.sponsorCollaboratorsModule?.leadSponsor?.name,
          investigators:p.contactsLocationsModule?.overallOfficials ?? [], contacts:p.contactsLocationsModule?.centralContacts ?? [], sites:p.contactsLocationsModule?.locations ?? [], sourceUrl:`https://clinicaltrials.gov/study/${id}`,
          conditions:p.conditionsModule?.conditions ?? [], keywords:p.conditionsModule?.keywords ?? [],
          meshTerms:(study.derivedSection?.conditionBrowseModule?.meshes ?? []).flatMap(m => m.term ? [m.term] : []),
          stdAges:p.eligibilityModule?.stdAges ?? [], minimumAge:p.eligibilityModule?.minimumAge, maximumAge:p.eligibilityModule?.maximumAge};
        records.set(id,r);
        claims.set(id,evidence("ctgov",r.sourceUrl,response.fetchedAt,"recruiting_study",`${r.title}; registry status RECRUITING; registry details: ${JSON.stringify({phases:r.phases,sponsor:r.sponsor,investigators:r.investigators,contacts:r.contacts,sites:r.sites})}`));
      }
      token = data.nextPageToken;
      if (!token) return {records:[...records.values()],evidence:[...claims.values()]};
      if (seen.has(token)) throw new SourceError("ctgov", "Repeated pagination token");
      seen.add(token);
    }
    throw new SourceError("ctgov", "Pagination limit reached; results are incomplete");
  }
}
