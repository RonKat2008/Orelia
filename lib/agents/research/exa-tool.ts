import { z } from "zod";
import type { AgentTool } from "@/lib/agents/runtime";
import type { ExaPort } from "./source-ports";
import { trackedTool, type ProvenanceTracker } from "./shared";

const MAX_TEXT_CHARS = 700;
const DEFAULT_RESULTS = 8;

const inputSchema = z.object({
  query: z.string().min(1).describe("Web search query"),
  numResults: z.number().int().min(1).max(10).optional(),
});

/** Tool: Exa web search. Each result's url is the only URL the agent may cite as a source. */
export function exaSearchTool(exa: ExaPort, tracker: ProvenanceTracker): AgentTool {
  return trackedTool({
    name: "search_web",
    description:
      "Search the web (Exa) for organizations, programs or pages. Returns title, url and a text excerpt for each result.",
    inputSchema,
    kind: "exa",
    tracker,
    run: async ({ query, numResults }) => {
      const results = await exa.search({ query, numResults: numResults ?? DEFAULT_RESULTS });
      return {
        query,
        results: results.map((r) => ({ title: r.title, url: r.url, excerpt: r.text?.slice(0, MAX_TEXT_CHARS) })),
      };
    },
  });
}
