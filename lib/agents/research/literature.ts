import { pubmedAuthorsTool } from "./pubmed-tool";
import { runResearch } from "./shared";
import type { ResearchAgent } from "./types";
import { HAIKU } from "@/lib/agents/models";

const INSTRUCTIONS = `ROLE: Literature agent. Identify people who publish most often on the patient's disease, using PubMed results from tools.

Output up to 6 records of kind "expert": {"kind":"expert","id":"expert:<first>-<last lowercased>","name":"First Last","specialty"?:string,"evidenceRefs":[<sourceUrl>...]}.
- Do NOT set npi or credentials; another agent verifies identity.
- For each expert return 1-2 evidence items with claimType "disease_publications". Give every evidence item a unique "id" (for example "lit:<first>-<last>:<pmid>") and cite those ids in the record's evidenceRefs, so co-authors of one paper do not share each other's claims. The claim states only counts and PMIDs the tool returned (for example: "Appears as an author on 7 papers about <disease> in the PubMed results retrieved; includes PMID 123."). sourceUrl is a paper's sourceUrl exactly as the tool returned it.
- Describe publication activity only. Do not say who is best or recommend anyone.`;

export const literatureAgent: ResearchAgent = {
  name: "literature",
  model: HAIKU,
  run: runResearch({
    name: "literature",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["expert"] },
    makeTools: (ports, tracker) => [pubmedAuthorsTool(ports.pubmed, tracker)],
    seed: (call, c) => call("search_pubmed_authors", { disease: c.diseaseName }),
  }),
};
