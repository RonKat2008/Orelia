import type { CollectedSources } from "../contract";
import { collectReference } from "./reference";
import { collectRegistries } from "./registries";
import { collectResearch } from "./research";
import { collectStudies } from "./studies";
import type { CollectContext, Collector, CollectorResult } from "./types";

export * from "./types";

export const DEFAULT_COLLECTORS: Readonly<Record<string, Collector>> = {
  reference: collectReference,
  registries: collectRegistries,
  studies: collectStudies,
  research: collectResearch,
};

const GENERIC_FAILURE = "Source unavailable";

/** First occurrence wins (collector order is stable), so merging is deterministic. */
function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function mergeCollected(diseaseName: string, results: readonly CollectorResult[]): CollectedSources {
  return {
    diseaseName,
    sources: dedupeBy(results.flatMap(r => r.sources ?? []), s => s.id),
    prevalence: dedupeBy(results.flatMap(r => r.prevalence ?? []), p => `${p.sourceId}|${p.label}|${p.prevalenceType ?? ""}|${p.geography ?? ""}`),
    studies: dedupeBy(results.flatMap(r => r.studies ?? []), s => s.sourceId),
    research: dedupeBy(results.flatMap(r => r.research ?? []), r => r.sourceId),
    registries: dedupeBy(results.flatMap(r => r.registries ?? []), r => r.sourceId),
    errors: results.flatMap(r => r.errors ?? []),
  };
}

/** Run every collector in parallel; one failing collector never sinks the others. */
export async function collectAll(
  diseaseName: string,
  ctx: CollectContext,
  collectors: Readonly<Record<string, Collector>> = DEFAULT_COLLECTORS,
): Promise<CollectedSources> {
  const entries = Object.entries(collectors);
  const settled = await Promise.allSettled(entries.map(([, collect]) => collect(diseaseName, ctx)));
  const results: CollectorResult[] = settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : { errors: [{ source: entries[i][0], message: GENERIC_FAILURE }] },
  );
  return mergeCollected(diseaseName, results);
}
