/**
 * NEEDS ANALYST ("needs"): what a person with this condition needs from specialists, centers, trials and support
 * services, each need citing fetched sources. Disease-level output is cached per normalized disease (+subtype) for
 * 30 days and personalized per case in code. Never throws: on failure research proceeds without needs.
 */
import { modelFor } from "@/config/models";
import { cleanField, wrapUntrusted } from "@/lib/agents/research/untrusted";
import { caseSlug } from "@/lib/agents/research/shared";
import type { BriefSource, CollectedSources } from "@/lib/condition-brief/contract";
import { fixtureSlugFor } from "@/lib/condition-brief/build";
import type { CollectContext } from "@/lib/condition-brief/sources/types";
import { generatedNeedsSchema, type CareNeeds, type CareNeedsBase, type CaseInput, type GeneratedNeeds } from "@/lib/contracts";
import { isOffline } from "@/lib/env";
import { FetchTransport, FixtureTransport } from "@/lib/sources/transport";
import { buildNeedsPrompt, NEEDS_SYSTEM } from "../prompts/needs";
import type { RunStore, RunUpdate } from "../run-store";
import { runAgent, type MessagesClient } from "../runtime";
import { personalizeNeeds, type DocumentHint } from "./personalize";
import { collectNeedsSources, promptSources } from "./sources";
import { getNeedsStore, NEEDS_CACHE_TTL_MS, needsCacheKey, type NeedsStore } from "./store";
import { validateNeeds } from "./validate";

export const NEEDS_AGENT_NAME = "needs";
const EXCERPT_CHARS = 900;

export interface NeedsDeps {
  store: RunStore;
  needsStore?: NeedsStore;
  offline?: boolean;
  now?: () => Date;
  collect?: (diseaseName: string, ctx: CollectContext) => Promise<CollectedSources>;
  /** Patient documents (kinds only) for personalization. */
  documents?: (caseId: string) => Promise<DocumentHint[]>;
  /** Existing condition-brief sources for this case, reused instead of collecting again. */
  briefSources?: (caseId: string) => Promise<BriefSource[]>;
  client?: MessagesClient;
}

/** One run row per case for the "Understanding your condition" phase, also when the cache answers. */
class OneRowStore implements RunStore {
  constructor(private readonly inner: RunStore, private readonly runId: string) {}
  async create(): Promise<string> {
    return this.runId;
  }
  update(runId: string, patch: RunUpdate) {
    return this.inner.update(runId, patch);
  }
  listByCase(caseId: string) {
    return this.inner.listByCase(caseId);
  }
}

function summarize(n: CareNeedsBase, fromCache: boolean, ms: number): string {
  const parts = [
    `${n.specialties.length} specialties`,
    `${n.centerCapabilities.length} center capabilities`,
    `${n.redFlags.length} red flags`,
    `${n.trialEligibility.length} trial checks`,
    `${n.supportNeeds.length} support needs`,
    `${n.sources.length} sources`,
  ];
  return `${parts.join(", ")}${fromCache ? " (cached)" : ""} in ${(ms / 1000).toFixed(1)}s`;
}

function toPromptSources(sources: readonly BriefSource[]) {
  return promptSources(sources).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: cleanField(s.title, 200) ?? s.id,
    excerpt: s.excerpt ? wrapUntrusted(s.excerpt, EXCERPT_CHARS, s.id) : undefined,
  }));
}

async function generate(caseId: string, c: CaseInput, sources: BriefSource[], store: RunStore, client?: MessagesClient): Promise<GeneratedNeeds> {
  const codes = c.diseaseCodes ? Object.fromEntries(Object.entries(c.diseaseCodes).filter(([, v]) => !!v)) : undefined;
  return runAgent({
    name: NEEDS_AGENT_NAME,
    model: modelFor("needs"),
    system: NEEDS_SYSTEM,
    prompt: buildNeedsPrompt({ diseaseName: c.diseaseName, ...(c.subtype ? { subtype: c.subtype } : {}), ...(codes ? { codes } : {}) }, toPromptSources(sources)),
    tools: [],
    output: generatedNeedsSchema,
    caseId,
    store,
    offlineKey: caseSlug(c),
    maxTurns: 1,
    temperature: 0,
    perItemAdviceFilter: true,
    ...(client ? { client } : {}),
  });
}

/** Personalized needs for the case, or undefined when no sourced needs could be produced. */
export async function runNeedsAnalyst(caseId: string, c: CaseInput, deps: NeedsDeps): Promise<CareNeeds | undefined> {
  const started = Date.now();
  const now = (deps.now ?? (() => new Date()))();
  const offline = deps.offline ?? isOffline();
  const needsStore = deps.needsStore ?? getNeedsStore();
  const runId = await deps.store.create(caseId, NEEDS_AGENT_NAME);
  const rowStore = new OneRowStore(deps.store, runId);
  const finish = async (patch: RunUpdate) => deps.store.update(runId, { ...patch, finishedAt: new Date() }).catch(() => undefined);
  const documents = async () => (deps.documents ? deps.documents(caseId).catch(() => []) : []);
  try {
    await deps.store.update(runId, { status: "running", startedAt: new Date() });
    const cacheKey = needsCacheKey(c.diseaseName, c.subtype);
    const cached = await needsStore.findBase(cacheKey, new Date(now.getTime() - NEEDS_CACHE_TTL_MS)).catch(() => null);
    if (cached) {
      const needs = personalizeNeeds(cached, caseId, c, { fromCache: true, elapsedMs: Date.now() - started, documents: await documents() });
      await needsStore.saveNeeds(needs).catch(() => undefined);
      await finish({ status: "done", outputSummary: summarize(cached, true, needs.elapsedMs) });
      return needs;
    }

    const fixtureSlug = fixtureSlugFor(c.diseaseName);
    if (offline && !fixtureSlug) {
      await finish({ status: "not_implemented", outputSummary: "Offline needs exist only for the three demo conditions" });
      return undefined;
    }
    const reused = (await deps.briefSources?.(caseId).catch(() => [])) ?? [];
    const sources =
      reused.length >= 3
        ? reused
        : (
            await (deps.collect ?? collectNeedsSources)(c.diseaseName, {
              transport: offline ? new FixtureTransport() : new FetchTransport(),
              offline,
              fixtureSlug,
              exaApiKey: offline ? undefined : process.env.EXA_API_KEY,
              ncbiApiKey: offline ? undefined : process.env.NCBI_API_KEY,
              now,
            })
          ).sources;
    if (sources.length === 0) {
      await finish({ status: "failed", error: "No reference sources could be fetched for this condition" });
      return undefined;
    }

    const raw = await generate(caseId, c, sources, rowStore, deps.client);
    const validated = validateNeeds(raw, sources);
    const base: CareNeedsBase = {
      ...validated,
      cacheKey,
      diseaseName: c.diseaseName,
      ...(c.subtype ? { subtype: c.subtype } : {}),
      generatedAt: now.toISOString(),
      mode: offline ? "offline" : "live",
    };
    const kept = base.specialties.length + base.centerCapabilities.length + base.redFlags.length + base.trialEligibility.length + base.supportNeeds.length;
    if (kept === 0) {
      await finish({ status: "failed", error: `No sourced needs survived validation (${base.dropped.length} dropped)` });
      return undefined;
    }
    await needsStore.saveBase(caseId, base).catch((e) => console.error(`[needs] cache save failed: ${e instanceof Error ? e.message : String(e)}`));
    const needs = personalizeNeeds(base, caseId, c, { fromCache: false, elapsedMs: Date.now() - started, documents: await documents() });
    await needsStore.saveNeeds(needs).catch(() => undefined);
    await finish({ status: "done", counts: { needs: kept, sources: base.sources.length, dropped: base.dropped.length }, outputSummary: summarize(base, false, needs.elapsedMs) });
    return needs;
  } catch (e) {
    await finish({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return undefined;
  }
}

export { needsCacheKey, getNeedsStore, MemoryNeedsStore, PostgresNeedsStore, setNeedsStoreForTests, NEEDS_CACHE_TTL_MS } from "./store";
export type { NeedsStore } from "./store";
export { validateNeeds, deriveSearchTerms, cleanSearchTerm } from "./validate";
export { personalizeNeeds } from "./personalize";
