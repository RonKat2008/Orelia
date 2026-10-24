import { pubmedAuthorsTool } from "./pubmed-tool";
import { runResearch, type ProvenanceTracker } from "./shared";
import type { ResearchAgent } from "./types";
import { HAIKU } from "@/lib/agents/models";

const INSTRUCTIONS = `ROLE: Literature agent. Identify people who publish most often on the patient's disease, using PubMed results from tools.

Output up to 6 records of kind "expert": {"kind":"expert","id":"expert:<first>-<last lowercased>","name":"First Last","specialty"?:string,"evidenceRefs":[<sourceUrl>...]}.
- Do NOT set npi or credentials; another agent verifies identity.
- For each expert return 1-2 evidence items with claimType "disease_publications". Give every evidence item a unique "id" (for example "lit:<first>-<last>:<pmid>") and cite those ids in the record's evidenceRefs, so co-authors of one paper do not share each other's claims. The claim starts with the author's full name exactly as the tool returned it and states only counts and PMIDs the tool returned (for example: "<First Last> appears as an author on 7 papers about <disease> in the PubMed results retrieved; includes PMID 123."). sourceUrl is a paper's sourceUrl exactly as the tool returned it.
- Describe publication activity only. Do not say who is best or recommend anyone.`;

const PUBMED_URL = /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/$/;

/**
 * Publication claims are rebuilt from the PubMed tool record: the author must be one the tool listed on that PMID
 * and named in the model's claim; counts come from the tool, never from model prose.
 */
export function publicationClaim(item: { id?: string; claim: string; sourceUrl: string }, tracker: ProvenanceTracker): string | null {
  const pmid = PUBMED_URL.exec(item.sourceUrl)?.[1];
  if (!pmid) return null;
  const claim = item.claim.toLowerCase();
  const authors = tracker.authorsOf(pmid);
  // The prompt's example claim names no author; the evidence id ("lit:<first>-<last>:<pmid>") then identifies them.
  const idSlug = /^lit:([^:]+):/.exec(item.id ?? "")?.[1]?.replace(/[^a-z]/gi, "").toLowerCase();
  const author =
    authors.find((a) => claim.includes(a.name.toLowerCase())) ??
    (idSlug ? authors.find((a) => a.name.toLowerCase().replace(/[^a-z]/g, "") === idSlug) : undefined);
  if (!author) return null;
  const counts = author.profile?.paperCount !== undefined
    ? ` In the PubMed results retrieved for ${author.disease}, ${author.name} appears on ${author.profile.paperCount} paper(s), ${author.profile.recentPaperCount ?? 0} from the last 5 years.`
    : "";
  return `${author.name} is listed as an author of PMID ${pmid}.${counts}`;
}

export const literatureAgent: ResearchAgent = {
  name: "literature",
  model: HAIKU,
  run: runResearch({
    name: "literature",
    instructions: INSTRUCTIONS,
    rules: { allowedKinds: ["expert"], restateClaim: publicationClaim },
    makeTools: (ports, tracker) => [pubmedAuthorsTool(ports.pubmed, tracker)],
    seed: (call, c) => call("search_pubmed_authors", { disease: c.diseaseName }),
  }),
};
