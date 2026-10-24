import type { Transport } from "@/lib/sources/transport";
import type { CollectedSources } from "../contract";

/**
 * Shared input for every Condition Brief collector. In offline mode `transport` is a FixtureTransport and each
 * collector passes explicit fixture keys under `condition-brief/<fixtureSlug>/...` (see fixtures/api/MANIFEST.json).
 * In live mode the keys are ignored by FetchTransport.
 */
export interface CollectContext {
  transport: Transport;
  offline: boolean;
  /** Fixture case slug (epithelioid-sarcoma | vascular-eds | igg4-related-disease); required when offline. */
  fixtureSlug?: string;
  exaApiKey?: string;
  ncbiApiKey?: string;
  now: Date;
}

/** Each collector returns a slice of CollectedSources; collectAll merges and de-duplicates by source id. */
export type CollectorResult = Partial<Omit<CollectedSources, "diseaseName">>;
export type Collector = (diseaseName: string, ctx: CollectContext) => Promise<CollectorResult>;

/** Fixture key helper: undefined in live mode so FetchTransport never sees a key. */
export function fixtureKey(ctx: CollectContext, file: string): string | undefined {
  if (!ctx.offline) return undefined;
  if (!ctx.fixtureSlug) throw new Error("Offline condition brief requires a fixture case");
  return `condition-brief/${ctx.fixtureSlug}/${file}`;
}
