/**
 * Condition Brief collector: ongoing research = ClinicalTrials.gov (open studies) + NIH RePORTER (current grants).
 * Each sub-source fails independently into `errors`; the collector itself never throws.
 */
import { z } from "zod";
import { neutralizeUntrusted } from "@/lib/agents/research/untrusted";
import type { BriefSource, ResearchItem, SourceDesign } from "../contract";
import { ctgovPhaseDesign, designCeiling } from "./design";
import { fixtureKey, type CollectContext, type Collector } from "./types";

export const RESEARCH_FILES = { ctgov: "ctgov-studies.json", reporter: "reporter-projects.json" } as const;
export const CTGOV_STUDIES_URL = "https://clinicaltrials.gov/api/v2/studies";
export const REPORTER_URL = "https://api.reporter.nih.gov/v2/projects/search";
const CTGOV_PAGE_SIZE = 15;
const REPORTER_LIMIT = 6;
const CTGOV_STATUSES = "RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING";
const CTGOV_FIELDS = "NCTId,BriefTitle,OverallStatus,Phase,StudyType,LeadSponsorName,BriefSummary";
const TRIAL_EXCERPT_CAP = 2000;
const GRANT_EXCERPT_CAP = 2000;
const TITLE_CAP = 400;

export function ctgovStudiesUrl(disease: string): string {
  const url = new URL(CTGOV_STUDIES_URL);
  url.searchParams.set("query.cond", disease);
  url.searchParams.set("filter.overallStatus", CTGOV_STATUSES);
  url.searchParams.set("pageSize", String(CTGOV_PAGE_SIZE));
  url.searchParams.set("fields", CTGOV_FIELDS);
  return url.href;
}

export function reporterBody(disease: string, now: Date) {
  const year = now.getUTCFullYear();
  return {
    criteria: {
      advanced_text_search: { operator: "and", search_field: "projecttitle,terms,abstracttext", search_text: disease },
      fiscal_years: [year, year - 1],
    },
    offset: 0,
    limit: REPORTER_LIMIT,
    include_fields: ["ApplId", "ProjectNum", "ProjectTitle", "FiscalYear", "Organization", "AbstractText"],
  };
}

const ctgovSchema = z.object({
  studies: z.array(
    z.object({
      protocolSection: z
        .object({
          identificationModule: z.object({ nctId: z.string().regex(/^NCT\d{8}$/), briefTitle: z.string().optional(), officialTitle: z.string().optional() }).loose(),
          statusModule: z.object({ overallStatus: z.string().optional() }).loose().optional(),
          designModule: z.object({ studyType: z.string().optional(), phases: z.array(z.string()).optional() }).loose().optional(),
          sponsorCollaboratorsModule: z.object({ leadSponsor: z.object({ name: z.string().optional() }).loose().optional() }).loose().optional(),
          descriptionModule: z.object({ briefSummary: z.string().optional() }).loose().optional(),
        })
        .loose(),
    }).loose(),
  ),
});

const reporterSchema = z.object({
  results: z.array(
    z.object({
      appl_id: z.number().int(),
      project_num: z.string().min(1),
      project_title: z.string().nullish(),
      fiscal_year: z.number().int().nullish(),
      organization: z.object({ org_name: z.string().nullish() }).loose().nullish(),
      abstract_text: z.string().nullish(),
    }).loose(),
  ),
});

type Out = { sources: BriefSource[]; research: ResearchItem[] };

function trialDesign(studyType: string | undefined, phases: string[], title: string): SourceDesign {
  if (studyType === "OBSERVATIONAL" && phases.length === 0) {
    return /registry/i.test(title) ? "registry" : "primary_study";
  }
  return ctgovPhaseDesign(phases);
}

export function parseCtgov(body: string, fetchedAt: string): Out {
  const parsed = ctgovSchema.parse(JSON.parse(body));
  const out: Out = { sources: [], research: [] };
  const seen = new Set<string>();
  for (const { protocolSection: p } of parsed.studies) {
    const nct = p.identificationModule.nctId;
    if (seen.has(nct)) continue;
    seen.add(nct);
    const rawTitle = p.identificationModule.briefTitle ?? p.identificationModule.officialTitle ?? nct;
    const title = neutralizeUntrusted(rawTitle).slice(0, TITLE_CAP) || nct;
    const phases = (p.designModule?.phases ?? []).filter((x) => x !== "");
    const design = trialDesign(p.designModule?.studyType, phases, title);
    const sponsor = p.sponsorCollaboratorsModule?.leadSponsor?.name;
    const cleanSponsor = sponsor ? neutralizeUntrusted(sponsor).slice(0, 200) : undefined;
    const summary = p.descriptionModule?.briefSummary;
    const excerpt = summary ? neutralizeUntrusted(summary).slice(0, TRIAL_EXCERPT_CAP) : undefined;
    const sourceId = `ctgov:${nct}`;
    out.sources.push({
      id: sourceId, kind: "ctgov", design, url: `https://clinicaltrials.gov/study/${nct}`, title,
      publisher: cleanSponsor || undefined, fetchedAt, excerpt: excerpt || undefined,
    });
    out.research.push({
      sourceId, kind: "trial", id: nct, title,
      status: p.statusModule?.overallStatus?.slice(0, 60),
      phase: phases.length ? phases.join("/").slice(0, 60) : undefined,
      sponsor: cleanSponsor || undefined,
      evidenceLevel: designCeiling(design),
    });
  }
  return out;
}

export function parseReporter(body: string, fetchedAt: string): Out {
  const parsed = reporterSchema.parse(JSON.parse(body));
  const out: Out = { sources: [], research: [] };
  const latest = new Map<string, (typeof parsed.results)[number]>();
  for (const r of parsed.results) {
    const prev = latest.get(r.project_num);
    if (!prev || (r.fiscal_year ?? 0) > (prev.fiscal_year ?? 0)) latest.set(r.project_num, r);
  }
  for (const r of latest.values()) {
    const num = r.project_num.slice(0, 40);
    const title = neutralizeUntrusted(r.project_title ?? "").slice(0, TITLE_CAP) || num;
    const org = r.organization?.org_name ? neutralizeUntrusted(r.organization.org_name).slice(0, 200) : undefined;
    const excerpt = r.abstract_text ? neutralizeUntrusted(r.abstract_text).slice(0, GRANT_EXCERPT_CAP) : undefined;
    const sourceId = `reporter:${num}`;
    out.sources.push({
      id: sourceId, kind: "reporter", design: "grant",
      url: `https://reporter.nih.gov/project-details/${r.appl_id}`, title,
      publisher: org || undefined, year: r.fiscal_year ?? undefined, fetchedAt, excerpt: excerpt || undefined,
    });
    out.research.push({
      sourceId, kind: "grant", id: num, title,
      status: r.fiscal_year ? `FY ${r.fiscal_year}` : undefined,
      sponsor: org || undefined,
      evidenceLevel: designCeiling("grant"),
    });
  }
  return out;
}

async function fetchCtgov(disease: string, ctx: CollectContext): Promise<Out> {
  const res = await ctx.transport.request({ url: ctgovStudiesUrl(disease), key: fixtureKey(ctx, RESEARCH_FILES.ctgov) });
  return parseCtgov(res.body, res.fetchedAt);
}

async function fetchReporter(disease: string, ctx: CollectContext): Promise<Out> {
  const res = await ctx.transport.request({
    url: REPORTER_URL, method: "POST", headers: { "content-type": "application/json" },
    body: reporterBody(disease, ctx.now), key: fixtureKey(ctx, RESEARCH_FILES.reporter),
  });
  return parseReporter(res.body, res.fetchedAt);
}

export const collectResearch: Collector = async (diseaseName, ctx) => {
  const errors: { source: string; message: string }[] = [];
  const sources: BriefSource[] = [];
  const research: ResearchItem[] = [];
  const parts: [string, string, () => Promise<Out>][] = [
    ["ctgov", "ClinicalTrials.gov unavailable", () => fetchCtgov(diseaseName, ctx)],
    ["reporter", "NIH RePORTER unavailable", () => fetchReporter(diseaseName, ctx)],
  ];
  const settled = await Promise.allSettled(parts.map(([, , run]) => run()));
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sources.push(...r.value.sources);
      research.push(...r.value.research);
    } else {
      errors.push({ source: parts[i][0], message: parts[i][1] });
    }
  });
  return { sources, research, errors };
};
