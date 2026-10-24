import { z } from "zod";
import { HAIKU } from "@/lib/agents/models";
import { toStateCode } from "./geo";
import { UNTRUSTED_NOTICE, cleanField } from "./untrusted";
import { runResearch, trackedTool } from "./shared";
import type { TrialRegistry } from "@/lib/contracts";
import type { CtgovPort, CtgovStudy } from "./source-ports";
import type { ResearchAgent } from "./types";
import { contactPoint, usPhoneToE164, type ContactPoint } from "@/lib/contact-finder/contact-points";
import type { AgentTool } from "@/lib/agents/runtime";
import type { ProvenanceTracker } from "./shared";

export const ctgovUrl = (nctId: string): string => `https://clinicaltrials.gov/study/${nctId}`;

const MAX_TRIALS = 12;
const MAX_SITES = 5;
const US = /^(united states|usa|us)$/i;

const RECRUITING_SITE = /^recruiting$/i;

type Site = CtgovStudy["sites"][number];

/**
 * A study's overall status can be RECRUITING while every site in the country has finished
 * (e.g. NCT04390737: overall RECRUITING, all four U.S. sites COMPLETED, recruiting only in China).
 * Such a study is not recruiting for a U.S. patient. A site with no stated status is unknown, not closed.
 */
export function hasRecruitingUsSite(usSites: readonly Site[]): boolean {
  return usSites.some((s) => !s.status || RECRUITING_SITE.test(s.status));
}

/** Recruiting sites first (stable), so the capped site list shown to the model never hides an open site. */
export function recruitingFirst(sites: readonly Site[]): Site[] {
  const open = (s: Site) => (s.status && RECRUITING_SITE.test(s.status) ? 0 : 1);
  return [...sites].sort((a, b) => open(a) - open(b));
}

/** Registry facts for filters and ranking, taken from the port response (US sites only). */
export function registryFacts(study: CtgovStudy, usSites: CtgovStudy["sites"]): TrialRegistry {
  const recruiting = usSites.filter((s) => s.status && RECRUITING_SITE.test(s.status));
  return {
    conditions: study.conditions ?? [],
    keywords: study.keywords ?? [],
    meshTerms: study.meshTerms ?? [],
    stdAges: study.stdAges ?? [],
    ...(study.minimumAge ? { minimumAge: study.minimumAge } : {}),
    ...(study.maximumAge ? { maximumAge: study.maximumAge } : {}),
    phases: study.phases ?? [],
    usSiteCount: usSites.length,
    usRecruitingSiteCount: recruiting.length,
    recruitingSiteStates: [
      ...new Set(recruiting.flatMap((s) => toStateCode(s.state) ?? [])),
    ].sort(),
    investigators: study.investigators ?? [],
    hasContact: study.hasContact ?? false,
  };
}

/** Registry central contacts as structured contact points (role mailboxes or US phones only). */
export function trialContactPoints(study: CtgovStudy): ContactPoint[] {
  const sourceUrl = ctgovUrl(study.nctId);
  return (study.centralContacts ?? []).flatMap((c) => {
    const phone = usPhoneToE164(c.phone);
    return [
      ...(c.email ? [contactPoint({ channel: "email", address: c.email, origin: "ctgov_central_contact", sourceUrl, sourceKind: "ctgov" })] : []),
      ...(phone ? [contactPoint({ channel: "voice", address: phone, origin: "ctgov_central_contact", sourceUrl, sourceKind: "ctgov" })] : []),
    ].filter((cp): cp is ContactPoint => cp !== null);
  });
}

const inputSchema = z.object({
  condition: z.string().min(1).describe("Condition to search"),
  state: z.string().length(2).optional().describe("Two-letter US state to prefer"),
});

function trialsTool(ctgov: CtgovPort, tracker: ProvenanceTracker): AgentTool {
  return trackedTool({
    name: "search_recruiting_trials",
    description:
      "Search ClinicalTrials.gov for studies currently recruiting for a condition. Only studies with at least one U.S. site that is recruiting are returned; each carries its ClinicalTrials.gov URL (sourceUrl).",
    inputSchema,
    kind: "ctgov",
    tracker,
    run: async ({ condition, state }) => {
      const studies = await ctgov.recruitingStudies({ condition, state });
      const usStudies = studies
        .map((s) => ({ ...s, sites: s.sites.filter((site) => site.country && US.test(site.country)) }))
        .filter((s) => s.sites.length > 0 && hasRecruitingUsSite(s.sites))
        .map((s) => ({ ...s, sites: recruitingFirst(s.sites) }))
        .slice(0, MAX_TRIALS);
      for (const s of usStudies) {
        tracker.rememberTrial(s.nctId, registryFacts(s, s.sites));
        tracker.rememberContactPoints(trialContactPoints(s));
      }
      return {
        notice: UNTRUSTED_NOTICE,
        trials: usStudies.map((s) => ({
          nctId: s.nctId,
          title: cleanField(s.title) ?? "",
          status: s.status,
          phases: s.phases,
          sponsor: cleanField(s.sponsor),
          usSites: s.sites.slice(0, MAX_SITES).map((site) => ({ ...site, facility: cleanField(site.facility) })),
          sourceUrl: ctgovUrl(s.nctId),
        })),
      };
    },
  });
}

const INSTRUCTIONS = `ROLE: Trials agent. List recruiting clinical trials for the patient's condition that have U.S. sites, using ClinicalTrials.gov results from tools.

Output records of kind "trial": {"kind":"trial","id":"trial:<nctId>","nctId":<exact nctId>,"title":<exact title>,"status":<status as returned>,"evidenceRefs":[<sourceUrl>]}.
- For each trial return one evidence item, claimType "trial_recruiting", sourceUrl exactly as returned. The claim states the NCT id, recruiting status, phase and sponsor if returned, and U.S. site cities (e.g. "ClinicalTrials.gov lists NCT0123 as RECRUITING (Phase 2, sponsor X) with U.S. sites in Boston, MA.").
- Do not judge whether a trial suits the patient, and do not compare trials or the interventions they test. Eligibility is for the trial team to decide.`;

export const trialsAgent: ResearchAgent = {
  name: "trials",
  model: HAIKU,
  run: runResearch({
    name: "trials",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["trial"] },
    makeTools: (ports, tracker) => [trialsTool(ports.ctgov, tracker)],
    seed: (call, c) => call("search_recruiting_trials", { condition: c.diseaseName }),
  }),
};
