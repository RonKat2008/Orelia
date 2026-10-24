import { z } from "zod";
import { HAIKU } from "@/lib/agents/models";
import type { AgentTool } from "@/lib/agents/runtime";
import { exaSearchTool } from "./exa-tool";
import { runResearch, trackedTool, withNeedsQuery, type ProvenanceTracker } from "./shared";
import type { CentersPort } from "./source-ports";
import type { ResearchAgent } from "./types";

const MAX_CENTERS = 12;

/** Needs-driven centers query: the disease plus up to two sourced capability terms. */
export function centersNeedsQuery(diseaseName: string, terms: readonly string[]): string {
  return `${diseaseName} ${terms.slice(0, 2).join(" ")} clinic program United States`;
}

const inputSchema = z.object({
  diseaseName: z.string().min(1),
  homeState: z.string().length(2).optional(),
  travelLimitMiles: z.number().int().nonnegative().optional(),
});

function nciCentersTool(centers: CentersPort, tracker: ProvenanceTracker): AgentTool {
  return trackedTool({
    name: "match_nci_centers",
    description:
      "NCI-designated cancer centers that may fit the disease and travel limit. Returns nothing for non-cancer diseases. Each carries its NCI profile URL (url).",
    inputSchema,
    kind: "nci",
    tracker,
    run: async (input) => ({ centers: (await centers.match(input)).slice(0, MAX_CENTERS) }),
  });
}

const INSTRUCTIONS = `ROLE: Centers agent. Find specialty centers, clinics and programs for the patient's disease from (a) NCI-designated cancer centers and (b) web search results, both from tools.

Output records of kind "institution": {"kind":"institution","id":"inst:<short-lowercase-slug>","name":<name>,"institutionKind":"cancer_center"|"rare_disease_center"|"hospital","city"?:...,"state"?:<2 letters>,"evidenceRefs":[<url>]}.
- NCI centers: institutionKind "cancer_center", evidence claimType "nci_designation", sourceUrl = the center's url exactly as returned, claim states the designation, city and state returned.
- Web results: only U.S. institutions with a page showing a dedicated program, clinic or center for THIS disease (or its disease family). institutionKind "rare_disease_center" for a dedicated program, otherwise "hospital". claimType "disease_program", sourceUrl = result url exactly as returned, claim says only what the returned title/excerpt states. City/state only if the excerpt states them.
- Skip pediatric-only clinics, advocacy groups, non-U.S. sites, news and PDFs. At most 10 records. Do not rank institutions or say which is best.`;

export const centersAgent: ResearchAgent = {
  name: "centers",
  model: HAIKU,
  run: runResearch({
    name: "centers",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["institution"], sourceKinds: ["nci", "exa"] },
    makeTools: (ports, tracker) => [nciCentersTool(ports.centers, tracker), exaSearchTool(ports.exa, tracker)],
    seed: async (call, c, extras) => ({
      nci: await call("match_nci_centers", {
        diseaseName: c.diseaseName,
        ...(c.homeState ? { homeState: c.homeState } : {}),
        ...(c.travelLimitMiles !== undefined ? { travelLimitMiles: c.travelLimitMiles } : {}),
      }),
      web: await withNeedsQuery(
        call("search_web", { query: `${c.diseaseName} specialty center clinic program United States` }),
        extras,
        (t) => (t.centers.length ? () => call("search_web", { query: centersNeedsQuery(c.diseaseName, t.centers) }) : undefined),
      ),
    }),
  }),
};
