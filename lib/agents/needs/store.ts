/**
 * CareNeeds persistence:
 *  - table needs_cache, key = cacheKey: the disease-level needs, reused across cases until expires_at
 *    (NEEDS_CACHE_TTL_MS). Not tied to any case: no case id and no personal fields (strict schema), so it outlives
 *    the case that generated it.
 *  - coordination_records kind "care_needs", key "current": the personalized needs shown for this case.
 *  - kind "judge", key "current": the final judge result for this case.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { coordinationRecords, needsCache } from "@/db/schema";
import {
  careNeedsBaseSchema,
  careNeedsSchema,
  judgeResultSchema,
  type CareNeeds,
  type CareNeedsBase,
  type JudgeResult,
} from "@/lib/contracts";

export const NEEDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const KIND_NEEDS = "care_needs";
export const KIND_JUDGE = "judge";
const CURRENT = "current";
const CACHE_VERSION = "v1";

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && w !== "the")
    .join("-");

/**
 * Cache key: normalized disease (+ subtype). Case, punctuation, accents and a trailing "syndrome/disease/disorder"
 * do not split the cache; a different subtype does. Personal fields never enter the key.
 */
export function needsCacheKey(diseaseName: string, subtype?: string): string {
  const disease = slug(diseaseName).replace(/-(syndrome|disease|disorder)$/, "");
  const sub = subtype ? slug(subtype) : "";
  return `${CACHE_VERSION}:${disease}${sub ? `|${sub}` : ""}`;
}

export interface NeedsStore {
  /** Freshest disease-level needs for this key generated after `since`, from any case. */
  findBase(cacheKey: string, since: Date): Promise<CareNeedsBase | null>;
  /** Disease-level only: rejects any extra (case or personal) field. */
  saveBase(base: CareNeedsBase): Promise<void>;
  saveNeeds(needs: CareNeeds): Promise<void>;
  loadNeeds(caseId: string): Promise<CareNeeds | null>;
  saveJudge(result: JudgeResult): Promise<void>;
  loadJudge(caseId: string): Promise<JudgeResult | null>;
}

/** The cache row may hold the disease-level profile and nothing else. */
const cacheEntrySchema = careNeedsBaseSchema.strict();

export class MemoryNeedsStore implements NeedsStore {
  private readonly bases = new Map<string, { base: CareNeedsBase; expiresAt: number }>();
  private readonly needs = new Map<string, CareNeeds>();
  private readonly judges = new Map<string, JudgeResult>();

  constructor(private readonly clock: () => number = Date.now) {}

  async findBase(cacheKey: string, since: Date): Promise<CareNeedsBase | null> {
    const hit = this.bases.get(cacheKey);
    if (!hit || hit.expiresAt <= this.clock() || new Date(hit.base.generatedAt) <= since) return null;
    return structuredClone(hit.base);
  }
  async saveBase(base: CareNeedsBase): Promise<void> {
    const parsed = cacheEntrySchema.parse(structuredClone(base));
    const prev = this.bases.get(parsed.cacheKey);
    if (prev && prev.base.generatedAt > parsed.generatedAt) return;
    this.bases.set(parsed.cacheKey, { base: parsed, expiresAt: new Date(parsed.generatedAt).getTime() + NEEDS_CACHE_TTL_MS });
  }
  async saveNeeds(n: CareNeeds): Promise<void> {
    this.needs.set(n.caseId, careNeedsSchema.parse(structuredClone(n)));
  }
  async loadNeeds(caseId: string): Promise<CareNeeds | null> {
    const n = this.needs.get(caseId);
    return n ? structuredClone(n) : null;
  }
  async saveJudge(r: JudgeResult): Promise<void> {
    this.judges.set(r.caseId, judgeResultSchema.parse(structuredClone(r)));
  }
  async loadJudge(caseId: string): Promise<JudgeResult | null> {
    const r = this.judges.get(caseId);
    return r ? structuredClone(r) : null;
  }
}

type Db = ReturnType<typeof getDb>;

export class PostgresNeedsStore implements NeedsStore {
  constructor(private readonly dbFactory: () => Db = getDb) {}
  private get db() {
    return this.dbFactory();
  }

  private async upsert(caseId: string, kind: string, key: string, data: Record<string, unknown>): Promise<void> {
    const values = { data, updatedAt: new Date() };
    await this.db
      .insert(coordinationRecords)
      .values({ caseId, kind, key, ...values })
      .onConflictDoUpdate({ target: [coordinationRecords.caseId, coordinationRecords.kind, coordinationRecords.key], set: values });
  }

  private async get(caseId: string, kind: string): Promise<unknown> {
    const [row] = await this.db
      .select({ data: coordinationRecords.data })
      .from(coordinationRecords)
      .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, kind), eq(coordinationRecords.key, CURRENT)))
      .limit(1);
    return row?.data ?? null;
  }

  async findBase(cacheKey: string, since: Date): Promise<CareNeedsBase | null> {
    const [row] = await this.db
      .select({ data: needsCache.data })
      .from(needsCache)
      .where(and(eq(needsCache.cacheKey, cacheKey), gt(needsCache.expiresAt, new Date()), gt(needsCache.generatedAt, since)))
      .limit(1);
    const parsed = careNeedsBaseSchema.safeParse(row?.data);
    return parsed.success ? parsed.data : null;
  }
  async saveBase(base: CareNeedsBase): Promise<void> {
    const parsed = cacheEntrySchema.parse(base);
    const generatedAt = new Date(parsed.generatedAt);
    const values = {
      diseaseName: parsed.diseaseName,
      subtype: parsed.subtype ?? null,
      data: parsed as unknown as Record<string, unknown>,
      generatedAt,
      expiresAt: new Date(generatedAt.getTime() + NEEDS_CACHE_TTL_MS),
      updatedAt: new Date(),
    };
    await this.db
      .insert(needsCache)
      .values({ cacheKey: parsed.cacheKey, ...values })
      // Never replace a fresher profile with an older one.
      .onConflictDoUpdate({ target: needsCache.cacheKey, set: values, setWhere: sql`${needsCache.generatedAt} <= ${generatedAt}` });
  }
  async saveNeeds(n: CareNeeds): Promise<void> {
    await this.upsert(n.caseId, KIND_NEEDS, CURRENT, careNeedsSchema.parse(n) as unknown as Record<string, unknown>);
  }
  async loadNeeds(caseId: string): Promise<CareNeeds | null> {
    const parsed = careNeedsSchema.safeParse(await this.get(caseId, KIND_NEEDS));
    return parsed.success ? parsed.data : null;
  }
  async saveJudge(r: JudgeResult): Promise<void> {
    await this.upsert(r.caseId, KIND_JUDGE, CURRENT, judgeResultSchema.parse(r) as unknown as Record<string, unknown>);
  }
  async loadJudge(caseId: string): Promise<JudgeResult | null> {
    const parsed = judgeResultSchema.safeParse(await this.get(caseId, KIND_JUDGE));
    return parsed.success ? parsed.data : null;
  }
}

const g = globalThis as unknown as { __wayfinderNeedsStore?: NeedsStore };

export function getNeedsStore(): NeedsStore {
  g.__wayfinderNeedsStore ??= process.env.DATABASE_URL ? new PostgresNeedsStore() : new MemoryNeedsStore();
  return g.__wayfinderNeedsStore;
}

export function setNeedsStoreForTests(store: NeedsStore | undefined): void {
  if (store) g.__wayfinderNeedsStore = store;
  else delete g.__wayfinderNeedsStore;
}
