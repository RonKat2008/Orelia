/**
 * FINAL JUDGE ("judge"): replaces the curator. Input: every verified, ranked candidate with its score breakdown,
 * plus CareNeeds. Output: keep/maybe/drop + tier + reason per candidate, validated by guardrails.ts, plus a
 * curator-compatible ValidatedCuration so the shortlist, suggestions and outreach cap keep working unchanged.
 */
import { modelFor } from "@/config/models";
import { rawJudgeOutputSchema, type CareNeeds, type CaseInput, type JudgeResult, type RawJudgeOutput, type ScopeFlag } from "@/lib/contracts";
import { isReachable } from "@/lib/outreach/reachability";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import type { ValidatedCuration } from "../curator";
import { resourceName, type RankedEntry } from "../persist";
import { buildJudgePrompt, JUDGE_SYSTEM } from "../prompts/judge";
import type { RunStore, RunUpdate } from "../run-store";
import { addUsage, emptyUsage, type Usage } from "@/lib/ai/usage";
import { isOffline } from "@/lib/env";
import { saveFixture } from "../replay";
import { runAgent, type MessagesClient } from "../runtime";
import { guardJudgements, kindIndex, TIER_ORDER } from "./guardrails";
import { candidateFacts, scopeFlags, type CandidateFacts } from "./scope";

export const JUDGE_AGENT_NAME = "judge";
export const SUGGESTED_MAX = 5;
const CLAIM_CHARS = 280;

export interface JudgeDeps {
  store: RunStore;
  offlineKey: string;
  chunkSize?: number;
  concurrency?: number;
  client?: MessagesClient;
  now?: () => Date;
}

export interface JudgeOutcome {
  result: JudgeResult;
  curation: ValidatedCuration;
}

function sortedEntries(ranked: readonly RankedEntry[]): RankedEntry[] {
  return [...ranked].sort((a, b) => kindIndex(a.record.resource.kind) - kindIndex(b.record.resource.kind) || a.rank - b.rank);
}

function needsView(needs: CareNeeds | undefined) {
  if (!needs) return null;
  const pick = <T extends { id: string }>(items: readonly T[], f: (i: T) => string) => items.map((i) => ({ id: i.id, need: f(i) }));
  return {
    specialties: pick(needs.specialties, (s) => `${s.specialty}${s.subspecialty ? ` (${s.subspecialty})` : ""}: ${s.why}`),
    centerCapabilities: pick(needs.centerCapabilities, (c) => c.text),
    redFlags: needs.redFlags.map((r) => ({ id: r.id, need: r.text, appliesTo: r.appliesTo })),
    trialEligibility: pick(needs.trialEligibility, (e) => `${e.feature}: ${e.text}`),
    supportNeeds: pick(needs.supportNeeds, (s) => `${s.kind}: ${s.text}`),
  };
}

export function buildJudgeInput(
  c: CaseInput,
  ranked: readonly RankedEntry[],
  needs: CareNeeds | undefined,
  flags: ReadonlyMap<string, ScopeFlag[]>,
  facts: ReadonlyMap<string, CandidateFacts> = new Map(ranked.map((e) => [e.record.resource.id, candidateFacts(e, c, flags.get(e.record.resource.id) ?? [])])),
) {
  return {
    case: {
      diagnosis: c.diseaseName,
      ...(c.subtype ? { subtype: c.subtype } : {}),
      ...(c.homeState ? { state: c.homeState } : {}),
      travelLimitMiles: c.travelLimitMiles ?? null,
      goals: [...c.goals],
      adultsOnly: true,
    },
    careNeeds: needsView(needs),
    candidates: sortedEntries(ranked)
      .map((e) => ({
        candidateId: e.record.resource.id,
        kind: e.record.resource.kind,
        name: resourceName(e.record.resource),
        rank: e.rank,
        score: e.score,
        breakdown: e.breakdown.map((b) => ({ factor: b.factor, points: b.points, text: b.text })),
        flags: (flags.get(e.record.resource.id) ?? []).map((f) => ({ code: f.code, hard: f.hard, text: f.text })),
        facts: facts.get(e.record.resource.id) ?? candidateFacts(e, c, flags.get(e.record.resource.id) ?? []),
        evidence: e.record.evidence.map((ev) => ({ id: ev.id, claimType: ev.claimType, claim: ev.claim.slice(0, CLAIM_CHARS), sourceKind: ev.sourceKind })),
      })),
  };
}

/** Curator-compatible view: tiers for every candidate, evidence-cited reasons, best+keep+reachable suggestions. */
export function toCuration(result: JudgeResult, ranked: readonly RankedEntry[]): ValidatedCuration {
  const byId = new Map(ranked.map((e) => [e.record.resource.id, e]));
  const tiers = sortedEntries(ranked).map((e) => {
    const j = result.judgements.find((x) => x.candidateId === e.record.resource.id);
    return {
      candidateId: e.record.resource.id,
      kind: e.record.resource.kind,
      tier: j?.tier ?? "backup",
      reasons: j && j.evidenceIds.length ? [{ text: j.reason.slice(0, 400), evidenceIds: j.evidenceIds }] : [],
    };
  });
  // Suggested picks = keeps, by tier then score (capped). The shortlist only pre-selects reachable ones, so those
  // that have a contact route come first; an unreachable keep can still be picked by hand.
  const reach = (id: string) => (isReachable(byId.get(id)?.record.evidence ?? []) ? 0 : 1);
  const suggested = result.judgements
    .filter((j) => j.verdict === "keep")
    .sort((a, b) => reach(a.candidateId) - reach(b.candidateId) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || b.score - a.score || a.rank - b.rank || (a.candidateId < b.candidateId ? -1 : 1))
    .slice(0, SUGGESTED_MAX)
    .map((j) => j.candidateId);
  return {
    tiers,
    summary: result.summary,
    suggested,
    dropped: result.rejected.map((r) => ({ ...(r.candidateId ? { candidateId: r.candidateId } : {}), what: "pick" as const, why: r.why })),
    source: result.source,
  };
}

export function judgeFromRaw(
  caseId: string,
  c: CaseInput,
  ranked: readonly RankedEntry[],
  needs: CareNeeds | undefined,
  raw: RawJudgeOutput | undefined,
  meta: { model: string; elapsedMs: number; now: Date; failure?: string },
): JudgeResult {
  const flags = new Map(ranked.map((e) => [e.record.resource.id, scopeFlags(e, c)]));
  const facts = new Map(ranked.map((e) => [e.record.resource.id, candidateFacts(e, c, flags.get(e.record.resource.id) ?? [])]));
  const source = raw ? "model" : "fallback";
  const { judgements, rejected } = guardJudgements(raw, { entries: ranked, needs, flags, facts, source });
  const summary = raw?.summary && !flagMedicalAdvice(raw.summary).flagged ? raw.summary : "";
  const count = (v: string) => judgements.filter((j) => j.verdict === v).length;
  return {
    caseId,
    generatedAt: meta.now.toISOString(),
    source,
    model: meta.model,
    summary,
    counts: { keep: count("keep"), maybe: count("maybe"), drop: count("drop") },
    judgements,
    rejected: meta.failure ? [{ why: `judge unavailable: ${meta.failure.slice(0, 200)}` }, ...rejected] : rejected,
    elapsedMs: Math.max(0, Math.round(meta.elapsedMs)),
  };
}

/** Candidates per model call, and how many calls run at once. ~3 verdicts per call keeps each call short (~10-15 s on the top tier). */
export const JUDGE_CHUNK_SIZE = 2;
export const JUDGE_CONCURRENCY = 12;
/** Largest list judged by the model; any beyond are shown on their deterministic score as "maybe". */
export const JUDGE_MAX_JUDGED = 60;

/**
 * One agent_runs row for the whole judge phase, shared by every chunk call: usage is summed across chunks (so the
 * case budget sees the real spend) and chunk-level terminal statuses are ignored; runJudge settles the row.
 */
class ChunkRowStore implements RunStore {
  private readonly usage = new Map<number, Usage>();
  private next = 0;
  private readonly chunkOf = new Map<string, number>();
  constructor(private readonly inner: RunStore, private readonly caseId: string) {}
  private rowId?: Promise<string>;
  row(): Promise<string> {
    this.rowId ??= this.inner.create(this.caseId, JUDGE_AGENT_NAME);
    return this.rowId;
  }
  async create(): Promise<string> {
    const id = await this.row();
    const n = this.next++;
    const token = `${id}#${n}`;
    this.chunkOf.set(token, n);
    return token;
  }
  async update(token: string, patch: RunUpdate): Promise<void> {
    const n = this.chunkOf.get(token);
    const id = await this.row();
    if (n === undefined) return this.inner.update(token, patch);
    if (patch.tokensIn === undefined) return;
    this.usage.set(n, { tokensIn: patch.tokensIn ?? 0, tokensOut: patch.tokensOut ?? 0, cacheRead: patch.cacheRead ?? 0, cacheCreation: patch.cacheCreation ?? 0, costUsd: patch.costUsd ?? 0 });
    const total = [...this.usage.values()].reduce(addUsage, emptyUsage());
    await this.inner.update(id, { status: "running", ...total });
  }
  listByCase(caseId: string) {
    return this.inner.listByCase(caseId);
  }
}

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await work(items[i]!, i);
    }
  });
  await Promise.all(lanes);
  return out;
}

function codeSummary(r: JudgeResult, needs: CareNeeds | undefined): string {
  const n = needs ? needs.specialties.length + needs.centerCapabilities.length + needs.redFlags.length + needs.trialEligibility.length + needs.supportNeeds.length : 0;
  return `${r.counts.keep} kept, ${r.counts.maybe} maybe and ${r.counts.drop} set aside${n ? `, each checked against ${n} sourced needs for this condition` : ""}. Scores are unchanged; each verdict cites the candidate's own sources.`;
}

/**
 * Judge in parallel chunks (bounded concurrency). Each chunk is one short model call over a few candidates plus
 * the shared needs profile; verdicts stream into the judge row's progress as chunks land. Guardrails run once over
 * the merged output, so chunking never changes what code allows. A failed chunk leaves its candidates as scored
 * "maybe" rather than failing the phase.
 */
export async function runJudge(
  caseId: string,
  c: CaseInput,
  ranked: readonly RankedEntry[],
  needs: CareNeeds | undefined,
  deps: JudgeDeps,
): Promise<JudgeOutcome> {
  const started = Date.now();
  const now = (deps.now ?? (() => new Date()))();
  const model = modelFor("judge");
  if (ranked.length === 0) {
    const result = judgeFromRaw(caseId, c, ranked, needs, { judgements: [], summary: "" }, { model, elapsedMs: 0, now });
    return { result, curation: toCuration(result, ranked) };
  }
  const flags = new Map(ranked.map((e) => [e.record.resource.id, scopeFlags(e, c)]));
  const judged = sortedEntries(ranked).slice(0, JUDGE_MAX_JUDGED);
  const chunks: RankedEntry[][] = [];
  for (let i = 0; i < judged.length; i += deps.chunkSize ?? JUDGE_CHUNK_SIZE) chunks.push(judged.slice(i, i + (deps.chunkSize ?? JUDGE_CHUNK_SIZE)));
  const rows = new ChunkRowStore(deps.store, caseId);
  const rowId = await rows.row();
  let landed = 0;
  let keptSoFar = 0;
  const failures: string[] = [];
  const outputs = await pool(chunks, deps.concurrency ?? JUDGE_CONCURRENCY, async (chunk) => {
    const ids = new Set(chunk.map((e) => e.record.resource.id));
    try {
      const out = await runAgent({
        name: JUDGE_AGENT_NAME,
        model,
        system: JUDGE_SYSTEM,
        prompt: buildJudgePrompt(buildJudgeInput(c, chunk, needs, flags)),
        tools: [],
        output: rawJudgeOutputSchema,
        caseId,
        store: rows,
        offlineKey: deps.offlineKey,
        maxTurns: 1,
        temperature: 0,
        perItemAdviceFilter: true,
        record: false,
        ...(deps.client ? { client: deps.client } : {}),
      });
      // Offline the recorded fixture holds every verdict; each chunk keeps only its own candidates.
      const mine = out.judgements.filter((j) => ids.has(j.candidateId) || !byIdHas(ranked, j.candidateId));
      landed += chunk.length;
      keptSoFar += mine.filter((j) => j.verdict === "keep" && ids.has(j.candidateId)).length;
      await deps.store
        .update(rowId, { status: "running", counts: { judged: landed, total: judged.length }, outputSummary: `Judged ${landed} of ${judged.length} (${keptSoFar} kept so far)` })
        .catch(() => undefined);
      return mine;
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      landed += chunk.length;
      return [];
    }
  });
  const merged = outputs.flat();
  // A judgement for an id outside the input survives the merge only once, so the guardrails can reject it.
  const seenUnknown = new Set<string>();
  const deduped = merged.filter((j) => byIdHas(ranked, j.candidateId) || (!seenUnknown.has(j.candidateId) && seenUnknown.add(j.candidateId)));
  const anyOk = failures.length < chunks.length;
  const raw: RawJudgeOutput | undefined = anyOk ? { judgements: deduped, summary: "" } : undefined;
  if (anyOk && process.env.WAYFINDER_RECORD_LLM === "1" && !isOffline()) {
    await saveFixture(JUDGE_AGENT_NAME, deps.offlineKey, raw).catch(() => undefined);
  }
  const failure = failures.length ? `${failures.length} of ${chunks.length} judge call(s) failed: ${failures[0]!.slice(0, 160)}` : undefined;
  const base = judgeFromRaw(caseId, c, ranked, needs, raw, { model, elapsedMs: Date.now() - started, now, ...(failure ? { failure } : {}) });
  const result = { ...base, summary: raw ? codeSummary(base, needs) : "" };
  await deps.store
    .update(rowId, { status: "done", counts: { judged: judged.length, total: ranked.length, chunks: chunks.length, failedChunks: failures.length }, outputSummary: `${result.counts.keep} kept, ${result.counts.maybe} maybe, ${result.counts.drop} dropped in ${(result.elapsedMs / 1000).toFixed(1)}s`, finishedAt: new Date() })
    .catch(() => undefined);
  return { result, curation: toCuration(result, ranked) };
}

function byIdHas(ranked: readonly RankedEntry[], id: string): boolean {
  return ranked.some((e) => e.record.resource.id === id);
}

export { guardJudgements, needIds } from "./guardrails";
export { scopeFlags } from "./scope";
