import { HAIKU } from "@/lib/agents/models";
import { isUndiagnosed, type CaseInput, type Evidence, type ResearchResult } from "@/lib/contracts";
import { RARE_CLAIM_TYPES } from "@/lib/rare-disease/tags";
import { mentionStrength } from "@/lib/agents/relevance";
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
const GENERIC_WORDS = /\b(vascular|type|syndromes?|diseases?|disorders?|related|chronic|primary|hereditary)\b/gi;

/**
 * The page names the condition: its full name, or its core name without generic words as one phrase
 * ("Ehlers-Danlos" for vascular Ehlers-Danlos syndrome). A shared single word is not enough, so a registry for
 * epithelioid hemangioendothelioma never counts for epithelioid sarcoma.
 */
export function namesCondition(text: string, c: Pick<CaseInput, "diseaseName" | "subtype">): boolean {
  if (mentionStrength(text, c) === "exact") return true;
  const core = c.diseaseName.replace(GENERIC_WORDS, " ").replace(/\s+/g, " ").trim();
  return core.length >= 4 && mentionStrength(text, { diseaseName: core }) === "exact";
}

export function rareNetworkClaimType(c: CaseInput): NonNullable<FinalizeRules["claimTypeFor"]> {
  const undiagnosed = isUndiagnosed(c);
  // A consortium or registry page must name the patient's condition in full (or, undiagnosed, speak to that path).
  const aboutCase = (text: string): boolean => (undiagnosed ? /undiagnos/.test(text) : namesCondition(text, c));
  return (item, tracker) => {
    const tag = tracker.urlTag(item.sourceUrl);
    const host = hostOf(item.sourceUrl);
    const text = tracker.recordText(item.sourceUrl);
    if (tag === "udn") return undiagnosed && host.endsWith("undiagnosed.hms.harvard.edu") ? RARE_CLAIM_TYPES.udnIntake : null;
    if (tag === "rdcrn" && host.endsWith("rarediseasesnetwork.org")) {
      if (/registry/.test(pathOf(item.sourceUrl))) return RARE_CLAIM_TYPES.patientRegistry;
      return aboutCase(text) ? RARE_CLAIM_TYPES.rdcrnConsortium : null;
    }
    if (tag === "registries" && /registr|natural history/.test(text) && aboutCase(text)) return RARE_CLAIM_TYPES.patientRegistry;
    return null;
  };
}

const isRdcrnRegistry = (e: Evidence): boolean => e.claimType === RARE_CLAIM_TYPES.patientRegistry && hostOf(e.sourceUrl).endsWith("rarediseasesnetwork.org");

/** The RDCRN Contact Registry is kept only beside an RDCRN consortium for this disease, or for an undiagnosed case. */
export function keepContactRegistry(result: ResearchResult, c: CaseInput): ResearchResult {
  if (result.status !== "ok" || isUndiagnosed(c) || result.evidence.some((e) => e.claimType === RARE_CLAIM_TYPES.rdcrnConsortium)) return result;
  const drop = new Set(result.evidence.filter(isRdcrnRegistry));
  const records = result.records.filter((r) => {
    const cited = result.evidence.filter((e) => r.evidenceRefs.includes(e.id ?? e.sourceUrl) || r.evidenceRefs.includes(e.sourceUrl));
    return !(cited.length > 0 && cited.every((e) => drop.has(e) || e.id?.startsWith("cp:") || e.claimType.startsWith("contact") || e.claimType.startsWith("web_form")) && cited.some((e) => drop.has(e)));
  });
  const kept = new Set(records.flatMap((r) => r.evidenceRefs));
  return { ...result, records, evidence: result.evidence.filter((e) => kept.has(e.id ?? "") || kept.has(e.sourceUrl)) };
}

function registryQuery(c: CaseInput): string {
  return isUndiagnosed(c) ? "registry for people with undiagnosed rare disease United States" : `${c.diseaseName} patient registry join`;
}

export const rareNetworkAgent: ResearchAgent = {
  name: "rare_network",
  model: HAIKU,
  run: withBudget(async (c, ctx) => keepContactRegistry(await runResearch({
    name: "rare_network",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["registry"], sourceKinds: ["exa"], citeOwnUrl: true, claimTypeFor: rareNetworkClaimType(c) },
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
  })(c, ctx), c)),
};
