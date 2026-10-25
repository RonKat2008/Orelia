import { HAIKU } from "@/lib/agents/models";
import { runResearch } from "./shared";
import { directoryExa, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

/** Independent charitable foundations that run disease-specific funds (open or closed by disease), plus NORD. */
export const FUND_SITES = ["healthwellfoundation.org", "panfoundation.org"] as const;
export const NORD_SITES = ["rarediseases.org"] as const;

const INSTRUCTIONS = `ROLE: Disease fund agent. Find disease-specific financial assistance funds for the patient's disease at independent charitable foundations (HealthWell Foundation, PAN Foundation) and NORD patient assistance programs, using search results from tools.

Output records of kind "organization" with organizationKind "financial_aid": {"kind":"organization","id":"org:<foundation>-<fund-slug>","name":"<Foundation> - <fund name as the page states>","organizationKind":"financial_aid","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- Only a page for ONE named fund or program whose disease is THIS disease or explicitly covers it (for example a fund for the disease family the page lists it under). Skip general lists, home pages, news, PDFs, trial listings, login pages and funds for other diseases.
- One evidence item per record, claimType "disease_fund". The claim states the fund name and, when the excerpt states it, its status exactly as written (for example "Status: Open" or "closed to new patients"). Never guess a status, an amount or eligibility.
- At most 5 records. If nothing fits, return {"records":[],"evidence":[]}. No medical advice.`;

export const diseaseFundsAgent: ResearchAgent = {
  name: "disease_funds",
  model: HAIKU,
  run: runResearch({
    name: "disease_funds",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["financial_aid"], sourceKinds: ["exa"] },
    makeTools: (ports, tracker) => [
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_foundation_funds",
        description: "Search the HealthWell Foundation and PAN Foundation sites for disease fund pages (each page states whether the fund is open or closed).",
        sites: FUND_SITES,
        fixtureKey: "funds",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_nord_assistance",
        description: "Search NORD (rarediseases.org) for patient assistance programs for a disease.",
        sites: NORD_SITES,
        fixtureKey: "nord-assistance",
      }),
    ],
    seed: async (call, c) => {
      const [funds, nord] = await Promise.all([
        call("search_foundation_funds", { query: `${c.diseaseName} disease fund financial assistance` }),
        call("search_nord_assistance", { query: `${c.diseaseName} patient assistance program` }),
      ]);
      return { funds, nord };
    },
  }),
};
