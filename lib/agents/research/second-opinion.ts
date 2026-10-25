import { HAIKU } from "@/lib/agents/models";
import { isUndiagnosed, type CaseInput } from "@/lib/contracts";
import { RARE_CLAIM_TYPES } from "@/lib/rare-disease/tags";
import { runResearch, type FinalizeRules } from "./shared";
import { directoryExa, withBudget, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

const INSTRUCTIONS = `ROLE: Expert center agent. Find U.S. expert centers and clinics that are NORD Rare Disease Centers of Excellence, or that offer a second opinion, a remote (telehealth / virtual) consultation, or a genetics clinic visit for the patient's disease, using web search results from tools.

Output records of kind "institution": {"kind":"institution","id":"inst:<short-lowercase-slug>","name":<center or clinic name>,"institutionKind":"rare_disease_center"|"hospital","city"?:...,"state"?:<2 letters>,"evidenceRefs":[<url>]}.
- NORD Centers of Excellence: only a hospital or health system whose returned page states it is a NORD Rare Disease Center of Excellence. institutionKind "rare_disease_center".
- Other results: only U.S. hospitals, academic centers or clinics whose page offers a second opinion, a telehealth or virtual visit, or a genetics or genetic counseling clinic, for THIS disease or its disease family (for an undiagnosed case: a diagnostic or undiagnosed-disease program). institutionKind "rare_disease_center" for a dedicated program, otherwise "hospital".
- Skip doctor-ranking or directory sites, advocacy groups, news, PDFs, pediatric-only clinics, drug companies and non-U.S. sites.
- One evidence item per record, claimType "second_opinion_program", "telehealth_program" or "genetics_clinic" (code decides the NORD designation), sourceUrl = a result url exactly as returned. The claim says only what the returned title/excerpt states. City/state only if the excerpt states them.
- At most 8 records. If nothing fits, return {"records":[],"evidence":[]}. Do not rank or say which is best. The initial tool results are usually enough: call a tool again at most once, and only if they are empty. No medical advice.`;

const PROGRAM_CLAIMS = new Set(["second_opinion_program", "telehealth_program", "genetics_clinic"]);
const NORD_COE = /center[s]? of excellence/;
const NORD_NAME = /\bnord\b|national organization for rare disorders/;

/** NORD designation is stamped only when the NORD search returned the page AND the page text states it. */
export const secondOpinionClaimType: NonNullable<FinalizeRules["claimTypeFor"]> = (item, tracker) => {
  const tag = tracker.urlTag(item.sourceUrl);
  const text = tracker.recordText(item.sourceUrl);
  if (tag === "nord-coe") return NORD_COE.test(text) && NORD_NAME.test(text) ? RARE_CLAIM_TYPES.nordCenterOfExcellence : null;
  if (tag === "second-opinion" || tag === "telehealth") return PROGRAM_CLAIMS.has(item.claimType) ? item.claimType : "second_opinion_program";
  return null;
};

function topic(c: CaseInput): string {
  return isUndiagnosed(c) ? "undiagnosed rare disease diagnostic program" : c.diseaseName;
}

export const secondOpinionAgent: ResearchAgent = {
  name: "second_opinion",
  model: HAIKU,
  run: withBudget(runResearch({
    name: "second_opinion",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["institution"], sourceKinds: ["exa"], claimTypeFor: secondOpinionClaimType },
    makeTools: (ports, tracker) => [
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_nord_coe",
        description: "Search the web for hospitals designated NORD Rare Disease Centers of Excellence.",
        sites: [],
        fixtureKey: "nord-coe",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_second_opinion",
        description: "Search the web for second-opinion and genetics clinic programs at U.S. expert centers.",
        sites: [],
        fixtureKey: "second-opinion",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_telehealth",
        description: "Search the web for remote or virtual consultation programs for a disease at U.S. centers.",
        sites: [],
        fixtureKey: "telehealth",
      }),
    ],
    seed: async (call, c) => {
      const near = c.homeState ? ` ${c.homeState}` : "";
      const [nordCoe, secondOpinion, telehealth] = await Promise.all([
        call("search_nord_coe", { query: `hospital designated NORD Rare Disease Center of Excellence${near}` }),
        call("search_second_opinion", { query: `${topic(c)} second opinion genetics clinic adults United States hospital` }),
        call("search_telehealth", { query: `${topic(c)} telehealth virtual consultation United States` }),
      ]);
      return { nordCoe, secondOpinion, telehealth };
    },
  })),
};
