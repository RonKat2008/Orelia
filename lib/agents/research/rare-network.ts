import { HAIKU } from "@/lib/agents/models";
import type { CaseInput } from "@/lib/contracts";
import { runResearch } from "./shared";
import { directoryExa, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

/** NIH Rare Diseases Clinical Research Network (consortia, their contact registry) and the Undiagnosed Diseases Network. */
export const RDCRN_SITES = ["rarediseasesnetwork.org"] as const;
export const UDN_SITES = ["undiagnosed.hms.harvard.edu"] as const;

const INSTRUCTIONS = `ROLE: Research network agent. Find NIH Rare Diseases Clinical Research Network (RDCRN) consortia that study the patient's disease, the RDCRN Contact Registry, and (only when the case is undiagnosed) the Undiagnosed Diseases Network, using search results from tools.

Output records of kind "organization" with organizationKind "registry": {"kind":"organization","id":"org:<short-lowercase-slug>","name":<consortium or registry name>,"organizationKind":"registry","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- A consortium counts only if its returned page names THIS disease (or the disease family it belongs to) among the conditions it studies. Never include a consortium for a different disease.
- Include the RDCRN Contact Registry only when you found at least one consortium for this disease, or when the case is undiagnosed.
- Include the Undiagnosed Diseases Network only when the case is undiagnosed.
- One evidence item per record, claimType "research_network" or "patient_registry", sourceUrl = a result url exactly as returned. The claim says only what the returned title/excerpt states (what the network or registry is and who can join).
- At most 4 records. If nothing fits, return {"records":[],"evidence":[]}. No medical advice; never say a person qualifies for a study.`;

/** True for a case without a confirmed diagnosis (rare-disease lane flag, or an intake that says so). */
export function isUndiagnosed(c: CaseInput): boolean {
  return (c as { undiagnosed?: unknown }).undiagnosed === true || /\bundiagnos|\bno (confirmed )?diagnosis\b|\bunknown (condition|disease)\b/i.test(c.diseaseName);
}

export const rareNetworkAgent: ResearchAgent = {
  name: "rare_network",
  model: HAIKU,
  run: runResearch({
    name: "rare_network",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["registry"], sourceKinds: ["exa"] },
    makeTools: (ports, tracker) => [
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_rdcrn",
        description: "Search the NIH Rare Diseases Clinical Research Network site (rarediseasesnetwork.org): consortia, the diseases they study, and the RDCRN Contact Registry.",
        sites: RDCRN_SITES,
        fixtureKey: "rdcrn",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_udn",
        description: "Search the Undiagnosed Diseases Network site (undiagnosed.hms.harvard.edu): how to apply. Only for undiagnosed cases.",
        sites: UDN_SITES,
        fixtureKey: "udn",
      }),
    ],
    seed: async (call, c) => {
      const [rdcrn, udn] = await Promise.all([
        call("search_rdcrn", { query: `${c.diseaseName} consortium RDCRN contact registry` }),
        isUndiagnosed(c) ? call("search_udn", { query: "Undiagnosed Diseases Network how to apply adult" }) : Promise.resolve(undefined),
      ]);
      return { undiagnosed: isUndiagnosed(c), rdcrn, ...(udn ? { udn } : {}) };
    },
  }),
};
