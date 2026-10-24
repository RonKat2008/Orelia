import { HAIKU } from "@/lib/agents/models";
import { exaSearchTool } from "./exa-tool";
import { runResearch } from "./shared";
import type { ResearchAgent } from "./types";

const INSTRUCTIONS = `ROLE: Aid agent. Find U.S. financial assistance (copay, grants, cost help) and travel or lodging assistance programs relevant to the patient's disease, using web search results from tools.

Output records of kind "organization": {"kind":"organization","id":"org:<short-lowercase-slug>","name":<organization name>,"organizationKind":"financial_aid" | "travel_aid","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- financial_aid: grants, copay or cost assistance, second-opinion funds. travel_aid: travel, lodging or transport grants.
- Skip drug-manufacturer programs, news articles, PDFs, organizations outside the U.S., and pages that merely give general travel or health guidance.
- One evidence item per organization, claimType "financial_aid_program" or "travel_aid_program", sourceUrl = a result url exactly as returned. The claim says only what the returned title/excerpt states.
- At most 6 organizations. No medical advice.`;

export const aidAgent: ResearchAgent = {
  name: "aid",
  model: HAIKU,
  run: runResearch({
    name: "aid",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["financial_aid", "travel_aid"] },
    makeTools: (ports, tracker) => [exaSearchTool(ports.exa, tracker)],
    seed: (call, c) =>
      call("search_web", {
        query: `${c.diseaseName} financial assistance copay grant travel lodging assistance`,
      }),
  }),
};
