/**
 * Condition Brief pipeline: collect sources -> generate (LLM or fixture) -> validate deterministically -> assemble.
 * Never invents text: if live generation fails, the brief carries only collector-derived items and zero statements.
 */
import { caseSlug } from "@/lib/agents/research/shared";
import { isOffline } from "@/lib/env";
import { FetchTransport, FixtureTransport, type Transport } from "@/lib/sources/transport";
import {
  conditionBriefSchema,
  type CollectedSources,
  type ConditionBrief,
  type ConditionBriefStore,
  type GeneratedBrief,
} from "./contract";
import { generateBrief, type GenerateOptions } from "./generate";
import { collectAll } from "./sources";
import type { CollectContext } from "./sources/types";
import { getConditionBriefStore } from "./store";
import { usableSources, validateBrief, type DroppedItem } from "./validate";

export const OFFLINE_FIXTURE_SLUGS = ["epithelioid-sarcoma", "vascular-eds", "igg4-related-disease"] as const;
export type OfflineFixtureSlug = (typeof OFFLINE_FIXTURE_SLUGS)[number];

export class ConditionBriefUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConditionBriefUnavailableError";
  }
}

export interface BuildDeps {
  /** Defaults to isOffline() (WAYFINDER_OFFLINE). */
  offline?: boolean;
  now?: () => Date;
  store?: ConditionBriefStore;
  transport?: Transport;
  collect?: (diseaseName: string, ctx: CollectContext) => Promise<CollectedSources>;
  generate?: (collected: CollectedSources, options: GenerateOptions) => Promise<GeneratedBrief>;
}

/** Fixture slug for one of the three synthetic demo cases, or undefined. */
export function fixtureSlugFor(diseaseName: string): OfflineFixtureSlug | undefined {
  const slug = caseSlug({ diseaseName });
  return (OFFLINE_FIXTURE_SLUGS as readonly string[]).includes(slug) ? (slug as OfflineFixtureSlug) : undefined;
}

function collectorErrors(collected: CollectedSources): DroppedItem[] {
  return collected.errors.map(e => ({ id: `collector:${e.source}`, reason: e.message.slice(0, 200) }));
}

async function generateSafely(
  collected: CollectedSources,
  generate: NonNullable<BuildDeps["generate"]>,
  options: GenerateOptions,
): Promise<{ generated: unknown; note?: DroppedItem }> {
  if (options.offline) return { generated: await generate(collected, options) };
  try {
    return { generated: await generate(collected, options) };
  } catch {
    return {
      generated: { statements: [], questions: [] },
      note: { id: "generator", reason: "Summary generation failed; showing collected sources only" },
    };
  }
}

export async function buildConditionBrief(caseId: string, diseaseName: string, deps: BuildDeps = {}): Promise<ConditionBrief> {
  const offline = deps.offline ?? isOffline();
  const now = (deps.now ?? (() => new Date()))();
  const fixtureSlug = fixtureSlugFor(diseaseName);
  if (offline && !fixtureSlug) {
    throw new ConditionBriefUnavailableError("Offline mode only has condition briefs for the three demo conditions");
  }
  const store = deps.store ?? getConditionBriefStore();
  const ctx: CollectContext = {
    transport: deps.transport ?? (offline ? new FixtureTransport() : new FetchTransport()),
    offline,
    fixtureSlug,
    exaApiKey: offline ? undefined : process.env.EXA_API_KEY,
    ncbiApiKey: offline ? undefined : process.env.NCBI_API_KEY,
    now,
  };

  const collected = await (deps.collect ?? collectAll)(diseaseName, ctx);
  const { generated, note } = await generateSafely(collected, deps.generate ?? generateBrief, { offline, fixtureSlug });
  const validated = validateBrief(generated, collected);
  const previous = await store.latest(caseId);
  const keptSourceIds = new Set(validated.statements.flatMap(s => s.sourceIds));
  for (const list of [validated.prevalence, validated.studies, validated.research, validated.registries]) {
    for (const item of list) keptSourceIds.add(item.sourceId);
  }

  return conditionBriefSchema.parse({
    caseId,
    diseaseName,
    version: (previous?.version ?? 0) + 1,
    generatedAt: now.toISOString(),
    mode: offline ? "offline" : "live",
    sources: [...usableSources(collected.sources).values()].filter(s => keptSourceIds.has(s.id)),
    prevalence: validated.prevalence,
    statements: validated.statements,
    studies: validated.studies,
    research: validated.research,
    registries: validated.registries,
    questions: validated.questions,
    dropped: [...validated.dropped, ...(note ? [note] : []), ...collectorErrors(collected)],
  });
}
