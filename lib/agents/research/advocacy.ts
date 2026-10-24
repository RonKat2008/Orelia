import { HAIKU } from "@/lib/agents/models";
import { exaSearchTool } from "./exa-tool";
import { runResearch } from "./shared";
import type { ResearchAgent } from "./types";

const INSTRUCTIONS = `ROLE: Advocacy agent. Find U.S.-reachable patient advocacy organizations, foundations and support groups for the patient's disease, using web search results from tools.

Output records of kind "organization" with organizationKind "advocacy": {"kind":"organization","id":"org:<short-lowercase-slug>","name":<organization name>,"organizationKind":"advocacy","url":<result url exactly as returned>,"evidenceRefs":[<url>]}.
- Only organizations whose page is about THIS disease or its disease family (not a different disease with a similar name). Skip pages that are news articles, PDFs, social media, clinics or hospitals, and organizations outside the U.S.
- One evidence item per organization, claimType "advocacy_organization", sourceUrl = a result url exactly as returned. The claim says only what the returned title/excerpt states (what the organization is and who it serves).
- At most 6 organizations. No medical advice or treatment information.`;

export const advocacyAgent: ResearchAgent = {
  name: "advocacy",
  model: HAIKU,
  run: runResearch({
    name: "advocacy",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["organization"], organizationKinds: ["advocacy"] },
    makeTools: (ports, tracker) => [exaSearchTool(ports.exa, tracker)],
    seed: (call, c) =>
      call("search_web", { query: `${c.diseaseName} patient advocacy foundation support group` }),
  }),
};
