import { z } from "zod";
import type { AgentTool } from "@/lib/agents/runtime";
import { classifyIntakeDoors } from "@/lib/contact-finder";
import { contactPointsFromDoors } from "@/lib/contact-finder/contact-points";
import type { ExaPort } from "./source-ports";
import { trackedTool, type ProvenanceTracker } from "./shared";
import { UNTRUSTED_NOTICE, cleanField, wrapUntrusted } from "./untrusted";

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
      // Intake addresses come from the deterministic classifier over the fetched page text, never from the model.
      for (const r of results) tracker.rememberContactPoints(contactPointsFromDoors(classifyIntakeDoors(r)));
      return {
        query,
        notice: UNTRUSTED_NOTICE,
        results: results.map((r) => ({
          title: cleanField(r.title),
          url: r.url,
          excerpt: wrapUntrusted(r.text, MAX_TEXT_CHARS, r.url),
        })),
      };
    },
  });
}
