/**
 * CareNeeds persistence, using the generic coordination_records table (no new migration):
 *  - kind "care_needs_base", key = cacheKey: the disease-level needs (no personal fields), reused across cases for
 *    NEEDS_CACHE_TTL_MS. A deleted case takes its rows with it (ON DELETE CASCADE).
 *  - kind "care_needs", key "current": the personalized needs shown for this case.
 *  - kind "judge", key "current": the final judge result for this case.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { coordinationRecords } from "@/db/schema";
import {
  careNeedsBaseSchema,
  careNeedsSchema,
  judgeResultSchema,
  type CareNeeds,
  type CareNeedsBase,
  type JudgeResult,
} from "@/lib/contracts";

export const NEEDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const KIND_BASE = "care_needs_base";
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
  saveBase(caseId: string, base: CareNeedsBase): Promise<void>;
  saveNeeds(needs: CareNeeds): Promise<void>;
  loadNeeds(caseId: string): Promise<CareNeeds | null>;
  saveJudge(result: JudgeResult): Promise<void>;
  loadJudge(caseId: string): Promise<JudgeResult | null>;
}

export class MemoryNeedsStore implements NeedsStore {
  private readonly bases: { caseId: string; base: CareNeedsBase }[] = [];
  private readonly needs = new Map<string, CareNeeds>();
  private readonly judges = new Map<string, JudgeResult>();

  async findBase(cacheKey: string, since: Date): Promise<CareNeedsBase | null> {
    const hit = this.bases
      .filter((b) => b.base.cacheKey === cacheKey && new Date(b.base.generatedAt) > since)
      .sort((a, b) => b.base.generatedAt.localeCompare(a.base.generatedAt))[0];
    return hit ? structuredClone(hit.base) : null;
  }
  async saveBase(caseId: string, base: CareNeedsBase): Promise<void> {
    this.bases.push({ caseId, base: careNeedsBaseSchema.parse(structuredClone(base)) });
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
    const rows = await this.db
      .select({ data: coordinationRecords.data })
      .from(coordinationRecords)
      .where(and(eq(coordinationRecords.kind, KIND_BASE), eq(coordinationRecords.key, cacheKey), gt(coordinationRecords.updatedAt, since)))
      .orderBy(desc(coordinationRecords.updatedAt))
      .limit(1);
    const parsed = careNeedsBaseSchema.safeParse(rows[0]?.data);
    return parsed.success && new Date(parsed.data.generatedAt) > since ? parsed.data : null;
  }
  async saveBase(caseId: string, base: CareNeedsBase): Promise<void> {
    await this.upsert(caseId, KIND_BASE, base.cacheKey, careNeedsBaseSchema.parse(base) as unknown as Record<string, unknown>);
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
