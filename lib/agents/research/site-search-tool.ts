import { z } from "zod";
import type { AgentTool } from "@/lib/agents/runtime";
import { classifyIntakeDoors } from "@/lib/contact-finder";
import { contactPointsFromDoors } from "@/lib/contact-finder/contact-points";
import { webFormsOnPage } from "@/lib/contact-finder/web-forms";
import type { CaseInput, ResearchResult } from "@/lib/contracts";
import type { ExaPort, SourcePorts } from "./source-ports";
import type { ResearchContext } from "./types";
import { trackedTool, type ProvenanceTracker } from "./shared";
import { UNTRUSTED_NOTICE, cleanField, wrapUntrusted } from "./untrusted";

const MAX_TEXT_CHARS = 900;
const DEFAULT_RESULTS = 8;

const inputSchema = z.object({ query: z.string().min(1).describe("Search query") });

export interface SiteSearchSpec {
  name: string;
  description: string;
  /**
   * Official domains the search is restricted to, fixed by code (the model can never widen them). Empty = the
   * whole web.
   */
  sites: readonly string[];
  /** Recorded-response stem (fixtures/api/exa/<case>/<fixtureKey>.json) for offline replay of the seed call. */
  fixtureKey: string;
}

/**
 * The Exa lane for the rare-disease agents: its own client and rate limiter (when wired), so these searches run
 * beside the original agents' Exa calls instead of queueing behind them.
 */
export function directoryExa(ports: SourcePorts): ExaPort {
  return ports.exaDirectory ?? ports.exa;
}

/** Tool: Exa search restricted to fixed official sites. Each result's url is the only URL the agent may cite. */
export function siteSearchTool(exa: ExaPort, tracker: ProvenanceTracker, spec: SiteSearchSpec): AgentTool {
  return trackedTool({
    name: spec.name,
    description: spec.description,
    inputSchema,
    kind: "exa",
    tracker,
    run: async ({ query }) => {
      const results = await exa.search({
        query,
        numResults: DEFAULT_RESULTS,
        ...(spec.sites.length ? { includeDomains: [...spec.sites] } : {}),
        fixtureKey: spec.fixtureKey,
      });
      for (const r of results) {
        tracker.tagUrl(r.url, spec.fixtureKey);
        tracker.rememberContactPoints(contactPointsFromDoors(classifyIntakeDoors(r)));
        tracker.rememberWebForms(webFormsOnPage(r));
      }
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

/** Host of a URL, lowercased without "www."; "" when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Path of a URL, lowercased; "" when it does not parse. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Per-agent budget for the directory agents: a slow source ends as a clean error well before the swarm-wide ceiling. */
export const DIRECTORY_AGENT_BUDGET_MS = 60_000;

export function withBudget(
  run: (c: CaseInput, ctx: ResearchContext) => Promise<ResearchResult>,
  budgetMs: number = DIRECTORY_AGENT_BUDGET_MS,
): (c: CaseInput, ctx: ResearchContext) => Promise<ResearchResult> {
  return async (c, ctx) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ResearchResult>((resolve) => {
      timer = setTimeout(() => resolve({ status: "error", message: `timed out after ${budgetMs}ms` }), budgetMs);
    });
    try {
      return await Promise.race([run(c, ctx), timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}
