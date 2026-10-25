import { HAIKU } from "@/lib/agents/models";
import { runResearch } from "./shared";
import { directoryExa, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

const INSTRUCTIONS = `ROLE: Second opinion agent. Find U.S. expert centers and clinics that offer a second opinion, remote (telehealth / virtual) consultation, or a genetics clinic visit for the patient's disease, using web search results from tools.

Output records of kind "institution": {"kind":"institution","id":"inst:<short-lowercase-slug>","name":<center or clinic name>,"institutionKind":"rare_disease_center"|"hospital","city"?:...,"state"?:<2 letters>,"evidenceRefs":[<url>]}.
- Only U.S. hospitals, academic centers or clinics whose page offers a second opinion, a telehealth or virtual visit, or a genetics or genetic counseling clinic, for THIS disease or its disease family. institutionKind "rare_disease_center" for a dedicated program for this disease, otherwise "hospital".
- Skip doctor-ranking or directory sites, advocacy groups, news, PDFs, pediatric-only clinics, drug companies and non-U.S. sites.
- One evidence item per record, claimType "second_opinion_program", "telehealth_program" or "genetics_clinic", sourceUrl = a result url exactly as returned. The claim says only what the returned title/excerpt states. City/state only if the excerpt states them.
- At most 6 records. If nothing fits, return {"records":[],"evidence":[]}. Do not rank or say which is best. No medical advice.`;

export const secondOpinionAgent: ResearchAgent = {
  name: "second_opinion",
  model: HAIKU,
  run: runResearch({
    name: "second_opinion",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["institution"], sourceKinds: ["exa"] },
    makeTools: (ports, tracker) => [
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_second_opinion",
        description: "Search the web for second-opinion, telehealth and genetics clinic programs at U.S. expert centers.",
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
      const [secondOpinion, telehealth] = await Promise.all([
        call("search_second_opinion", { query: `${c.diseaseName} second opinion program adults United States hospital` }),
        call("search_telehealth", { query: `${c.diseaseName} telehealth virtual consultation genetics clinic United States` }),
      ]);
      return { secondOpinion, telehealth };
    },
  }),
};
