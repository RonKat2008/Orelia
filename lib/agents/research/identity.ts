import { z } from "zod";
import { HAIKU } from "@/lib/agents/models";
import type { AgentTool } from "@/lib/agents/runtime";
import { pubmedAuthorsTool } from "./pubmed-tool";
import { runResearch, trackedTool, type ProvenanceTracker } from "./shared";
import type { NppesPort } from "./source-ports";
import type { ResearchAgent } from "./types";

export const nppesProviderUrl = (npi: string): string =>
  `https://npiregistry.cms.hhs.gov/provider-view/${npi}`;

const SEED_AUTHORS = 6;

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");
const firstToken = (s: string): string => normalize(s.trim().split(/\s+/)[0] ?? "");

const inputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  state: z.string().length(2).optional().describe("Two-letter state, if known from the author's affiliation"),
});

/**
 * NPPES lookup. An NPI is only ever "verified" (registered with the tracker) when exactly one provider matches
 * the first and last name exactly. Zero or several matches are reported as ambiguous and never guessed.
 */
function lookupNpiTool(nppes: NppesPort, tracker: ProvenanceTracker): AgentTool {
  return trackedTool({
    name: "lookup_npi",
    description:
      "Look up a person in the NPPES NPI Registry by name (and state). Reports how many providers match the name exactly. Only a single exact match counts as verified.",
    inputSchema,
    kind: "nppes",
    tracker,
    run: async ({ firstName, lastName, state }) => {
      const result = await nppes.lookup({ firstName, lastName, state });
      const exact = result.providers.filter(
        (p) => firstToken(p.firstName) === firstToken(firstName) && normalize(p.lastName) === normalize(lastName),
      );
      const verified = exact.length === 1;
      if (verified && exact[0]) tracker.allowVerifiedNpi(exact[0].npi);
      return {
        query: { firstName, lastName, state },
        searchUrl: result.searchUrl,
        providersReturned: result.providers.length,
        exactNameMatches: exact.length,
        verified,
        matches: exact.slice(0, 5).map((p) => ({
          npi: p.npi,
          name: `${p.firstName} ${p.lastName}`,
          credential: p.credential,
          taxonomy: p.taxonomy,
          city: p.city,
          state: p.state,
          sourceUrl: nppesProviderUrl(p.npi),
        })),
      };
    },
  });
}

const INSTRUCTIONS = `ROLE: Identity agent. For people who publish on the patient's disease, check the NPPES NPI Registry and report whether each can be uniquely identified.

For each author you looked up, output one record of kind "expert": {"kind":"expert","id":...,"name":"First Last","npi":...,"credentials"?:...,"specialty"?:...,"evidenceRefs":[...]}.
- If the lookup says verified=true: npi = that match's npi, id = "npi:<npi>", credentials and specialty only as returned (credential, taxonomy), evidence claimType "identity_verified" with sourceUrl = the match's sourceUrl. The claim names the NPI, taxonomy and city/state returned.
- If verified=false (zero matches OR more than one exact match): NEVER guess. npi = null, id = "expert:<first>-<last lowercased>", no credentials. One evidence item, claimType "identity_unverified", sourceUrl = the lookup's searchUrl, claim saying how many exact name matches the registry returned and that identity was not confirmed.
- Never combine two registry entries, never pick one of several, never use an NPI the tool did not mark verified.`;

export const identityAgent: ResearchAgent = {
  name: "identity",
  model: HAIKU,
  run: runResearch({
    name: "identity",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["expert"], sourceKinds: ["nppes"] },
    makeTools: (ports, tracker) => [
      pubmedAuthorsTool(ports.pubmed, tracker),
      lookupNpiTool(ports.nppes, tracker),
    ],
    seed: async (call, c) => {
      const found = (await call("search_pubmed_authors", { disease: c.diseaseName, limit: SEED_AUTHORS })) as {
        authors: Array<{ firstName: string; lastName: string; state?: string }>;
      };
      const lookups = [];
      for (const a of found.authors) {
        lookups.push(
          await call("lookup_npi", {
            firstName: a.firstName,
            lastName: a.lastName,
            ...(a.state ? { state: a.state } : {}),
          }),
        );
      }
      return { authors: found.authors.map((a) => `${a.firstName} ${a.lastName}`), lookups };
    },
  }),
};
