import { HAIKU } from "@/lib/agents/models";
import { isUndiagnosed, type CaseInput } from "@/lib/contracts";
import { RARE_CLAIM_TYPES } from "@/lib/rare-disease/tags";
import { runResearch, type FinalizeRules } from "./shared";
import { directoryExa, withBudget, hostOf, pathOf, siteSearchTool } from "./site-search-tool";
import type { ResearchAgent } from "./types";

/** NIH Rare Diseases Clinical Research Network (consortia, their contact registry) and the Undiagnosed Diseases Network. */
export const RDCRN_SITES = ["rarediseasesnetwork.org"] as const;
export const UDN_SITES = ["undiagnosed.hms.harvard.edu"] as const;

const INSTRUCTIONS = `ROLE: Research network agent. Find, from tool results: NIH Rare Diseases Clinical Research Network (RDCRN) consortia that study the patient's disease, the RDCRN Contact Registry, patient registries for this disease, and (only when the case is undiagnosed) the Undiagnosed Diseases Network.

Output records of kind "organization" with organizationKind "registry": {"kind":"organization","id":"org:<short-lowercase-slug>","name":<consortium or registry name>,"organizationKind":"registry","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- A consortium or registry counts only if its returned page names THIS disease (or the disease family it belongs to). Never include one for a different disease. Skip news articles, PDFs, surveys and single research studies.
- Include the RDCRN Contact Registry only when you found an RDCRN consortium for this disease, or when the case is undiagnosed.
- Include the Undiagnosed Diseases Network only when the case is undiagnosed. For an undiagnosed case never name or guess a disease.
- One evidence item per record, sourceUrl = a result url exactly as returned (the claim type is set by code from the site; write "registry"). The claim says only what the returned title/excerpt states (what the network or registry is and who can join).
- At most 5 records. If nothing fits, return {"records":[],"evidence":[]}. The initial tool results are usually enough: call a tool again at most once, and only if they are empty. No medical advice; never say a person qualifies for a study.`;

/** Claim type from the official site that returned the URL (never from the model): drives the rare-disease tags. */
export const rareNetworkClaimType: NonNullable<FinalizeRules["claimTypeFor"]> = (item, tracker) => {
  const tag = tracker.urlTag(item.sourceUrl);
  const host = hostOf(item.sourceUrl);
  if (tag === "udn" && host.endsWith("undiagnosed.hms.harvard.edu")) return RARE_CLAIM_TYPES.udnIntake;
  if (tag === "rdcrn" && host.endsWith("rarediseasesnetwork.org")) {
    return /registry/.test(pathOf(item.sourceUrl)) ? RARE_CLAIM_TYPES.patientRegistry : RARE_CLAIM_TYPES.rdcrnConsortium;
  }
  if (tag === "registries" && /registr/.test(tracker.recordText(item.sourceUrl))) return RARE_CLAIM_TYPES.patientRegistry;
  return null;
};

function registryQuery(c: CaseInput): string {
  return isUndiagnosed(c) ? "registry for people with undiagnosed rare disease United States" : `${c.diseaseName} patient registry join`;
}

export const rareNetworkAgent: ResearchAgent = {
  name: "rare_network",
  model: HAIKU,
  run: withBudget(runResearch({
    name: "rare_network",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["registry"], sourceKinds: ["exa"], citeOwnUrl: true, claimTypeFor: rareNetworkClaimType },
    makeTools: (ports, tracker) => [
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_rdcrn",
        description: "Search the NIH Rare Diseases Clinical Research Network site (rarediseasesnetwork.org): consortia, the diseases they study, and the RDCRN Contact Registry.",
        sites: RDCRN_SITES,
        fixtureKey: "rdcrn",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_registries",
        description: "Search the web for patient registries for a disease (run by advocacy groups, NIH or academic centers).",
        sites: [],
        fixtureKey: "registries",
      }),
      siteSearchTool(directoryExa(ports), tracker, {
        name: "search_udn",
        description: "Search the Undiagnosed Diseases Network site (undiagnosed.hms.harvard.edu): how to apply. Only for undiagnosed cases.",
        sites: UDN_SITES,
        fixtureKey: "udn",
      }),
    ],
    seed: async (call, c) => {
      const undiagnosed = isUndiagnosed(c);
      const [rdcrn, registries, udn] = await Promise.all([
        call("search_rdcrn", { query: undiagnosed ? "RDCRN Contact Registry join" : `${c.diseaseName} consortium RDCRN contact registry` }),
        call("search_registries", { query: registryQuery(c) }),
        undiagnosed ? call("search_udn", { query: "Undiagnosed Diseases Network how to apply" }) : Promise.resolve(undefined),
      ]);
      return { undiagnosed, rdcrn, registries, ...(udn ? { udn } : {}) };
    },
  })),
};
