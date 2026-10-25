import { HAIKU } from "@/lib/agents/models";
import { isUndiagnosed, type CaseInput } from "@/lib/contracts";
import { mentionStrength } from "@/lib/agents/relevance";
import { runResearch, type FinalizeRules } from "./shared";
import { directoryExa, withBudget, hostOf, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

/** Independent charitable foundations that run disease-specific funds (open or closed by disease), plus NORD. */
export const FUND_SITES = ["healthwellfoundation.org", "panfoundation.org"] as const;
export const NORD_SITES = ["rarediseases.org"] as const;

const INSTRUCTIONS = `ROLE: Disease fund agent. Find disease-specific financial assistance funds for the patient's disease at independent charitable foundations (HealthWell Foundation, PAN Foundation) and NORD patient assistance programs, using search results from tools.

Output records of kind "organization" with organizationKind "financial_aid": {"kind":"organization","id":"org:<foundation>-<fund-slug>","name":"<Foundation> - <fund name as the page states>","organizationKind":"financial_aid","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- Only a page for ONE named fund or program whose disease is THIS disease or explicitly covers it (for example a fund for the disease family the page lists it under). Skip general lists, home pages, news, PDFs, trial listings, login pages and funds for other diseases. For an undiagnosed case, only programs open to people without a diagnosis (for example genetic testing help).
- One evidence item per record (the claim type is set by code; write "fund"). The claim states the fund name and, when the excerpt states it, its status exactly as written (for example "Status: Open" or "closed to new patients"). Never guess a status, an amount or eligibility.
- At most 5 records. If nothing fits, return {"records":[],"evidence":[]}. The initial tool results are usually enough: call a tool again at most once, and only if they are empty. No medical advice.`;

export function diseaseFundClaimType(c: CaseInput): NonNullable<FinalizeRules["claimTypeFor"]> {
  const undiagnosed = isUndiagnosed(c);
  return (item, tracker) => {
    const tag = tracker.urlTag(item.sourceUrl);
    const host = hostOf(item.sourceUrl);
    const text = tracker.recordText(item.sourceUrl);
    // Fund pages must name this condition (or its family); undiagnosed cases only get testing / undiagnosed programs.
    if (undiagnosed ? !/undiagnos|genetic test/.test(text) : mentionStrength(text, c) === "none") return null;
    if (tag === "funds" && FUND_SITES.some((d) => host.endsWith(d))) return "disease_fund";
    if (tag === "nord-assistance" && host.endsWith("rarediseases.org")) return "financial_aid_program";
    return null;
  };
}

const fundQuery = (c: CaseInput): string => (isUndiagnosed(c) ? "genetic testing financial assistance fund" : `${c.diseaseName} disease fund financial assistance`);

export const diseaseFundsAgent: ResearchAgent = {
  name: "disease_funds",
  model: HAIKU,
  run: withBudget((c, ctx) => runResearch({
    name: "disease_funds",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["financial_aid"], sourceKinds: ["exa"], citeOwnUrl: true, claimTypeFor: diseaseFundClaimType(c) },
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
        call("search_foundation_funds", { query: fundQuery(c) }),
        call("search_nord_assistance", { query: isUndiagnosed(c) ? "patient assistance program undiagnosed" : `${c.diseaseName} patient assistance program` }),
      ]);
      return { funds, nord };
    },
  })(c, ctx)),
};
