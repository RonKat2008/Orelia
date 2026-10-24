import { z } from "zod";
import type { AgentTool } from "@/lib/agents/runtime";
import type { PubmedPort } from "./source-ports";
import { trackedTool, type ProvenanceTracker } from "./shared";

export const pubmedUrl = (pmid: string): string => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

const DEFAULT_AUTHOR_LIMIT = 6;

const inputSchema = z.object({
  disease: z.string().min(1).describe("Disease name to search PubMed for"),
  limit: z.number().int().min(1).max(15).optional().describe("Max authors to return"),
});

/** Tool: top authors on PubMed papers about the disease, each paper carrying its PubMed URL. */
export function pubmedAuthorsTool(pubmed: PubmedPort, tracker: ProvenanceTracker): AgentTool {
  return trackedTool({
    name: "search_pubmed_authors",
    description:
      "Find the authors who appear most often on PubMed papers about a disease. Returns each author's paper counts and papers with their PubMed URLs (sourceUrl).",
    inputSchema,
    kind: "pubmed",
    tracker,
    run: async ({ disease, limit }) => {
      const hits = await pubmed.searchAuthors({ disease, limit: limit ?? DEFAULT_AUTHOR_LIMIT });
      return {
        authors: hits.map((h) => ({
          name: h.name,
          firstName: h.firstName,
          lastName: h.lastName,
          affiliation: h.affiliation,
          state: h.state,
          paperCount: h.paperCount,
          recentPaperCount: h.recentPaperCount,
          papers: h.papers.map((p) => ({ ...p, sourceUrl: pubmedUrl(p.pmid) })),
        })),
      };
    },
  });
}
