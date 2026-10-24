import { z } from "zod";
import { HAIKU } from "@/lib/agents/models";
import { toStateCode } from "./geo";
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

/** Registry facts for filters and ranking, taken from the port response (US sites only). */
export function registryFacts(study: CtgovStudy, usSites: CtgovStudy["sites"]): TrialRegistry {
  const recruiting = usSites.filter((s) => s.status && RECRUITING_SITE.test(s.status));
  return {
    conditions: study.conditions ?? [],
    keywords: study.keywords ?? [],
    meshTerms: study.meshTerms ?? [],
    stdAges: study.stdAges ?? [],
    ...(study.minimumAge ? { minimumAge: study.minimumAge } : {}),
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
      "Search ClinicalTrials.gov for studies currently recruiting for a condition. Only studies with at least one U.S. site are returned; each carries its ClinicalTrials.gov URL (sourceUrl).",
    inputSchema,
    kind: "ctgov",
    tracker,
    run: async ({ condition, state }) => {
      const studies = await ctgov.recruitingStudies({ condition, state });
      const usStudies = studies
        .map((s) => ({ ...s, sites: s.sites.filter((site) => site.country && US.test(site.country)) }))
        .filter((s) => s.sites.length > 0)
        .slice(0, MAX_TRIALS);
      for (const s of usStudies) {
        tracker.rememberTrial(s.nctId, registryFacts(s, s.sites));
        tracker.rememberContactPoints(trialContactPoints(s));
      }
      return {
        trials: usStudies.map((s) => ({
          nctId: s.nctId,
          title: s.title,
          status: s.status,
          phases: s.phases,
          sponsor: s.sponsor,
          usSites: s.sites.slice(0, MAX_SITES),
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
