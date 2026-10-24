import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { coordinationRecords } from '@/db/schema';
import {
  consultRequestSchema, kindSchemas, versionOf,
  type ConsultRequest, type CoordinationKind, type CoordinationStore, type KindMap,
} from './contract';

function parse<K extends CoordinationKind>(kind: K, raw: unknown): KindMap[K] | null {
  const parsed = kindSchemas[kind].safeParse(raw);
  return parsed.success ? (parsed.data as KindMap[K]) : null;
}

function tokenHashOf(kind: CoordinationKind, value: KindMap[CoordinationKind]): string | null {
  return kind === 'consult' ? (value as ConsultRequest).reviewTokenHash : null;
}

const mapKey = (caseId: string, kind: CoordinationKind, key: string) => `${caseId}\u0000${kind}\u0000${key}`;

/** Process-local store (dev/tests). Validated deep copies only, so callers cannot mutate saved state. */
export class MemoryCoordinationStore implements CoordinationStore {
  private readonly rows = new Map<string, { caseId: string; kind: CoordinationKind; value: unknown }>();

  async get<K extends CoordinationKind>(caseId: string, kind: K, key: string): Promise<KindMap[K] | null> {
    const row = this.rows.get(mapKey(caseId, kind, key));
    return row ? parse(kind, structuredClone(row.value)) : null;
  }

  async list<K extends CoordinationKind>(caseId: string, kind: K): Promise<KindMap[K][]> {
    return [...this.rows.values()]
      .filter(r => r.caseId === caseId && r.kind === kind)
      .map(r => parse(kind, structuredClone(r.value)))
      .filter((v): v is KindMap[K] => v !== null);
  }

  async save<K extends CoordinationKind>(caseId: string, kind: K, key: string, value: KindMap[K], expectedVersion?: number): Promise<KindMap[K] | null> {
    const valid = parse(kind, value);
    if (!valid) return null;
    const k = mapKey(caseId, kind, key);
    const current = this.rows.get(k);
    if (expectedVersion !== undefined) {
      const currentValue = current ? parse(kind, current.value) : null;
      if (!currentValue || versionOf(currentValue) !== expectedVersion) return null;
    }
    this.rows.set(k, { caseId, kind, value: structuredClone(valid) });
    return valid;
  }

  async consultByTokenHash(tokenHash: string): Promise<ConsultRequest | null> {
    for (const row of this.rows.values()) {
      if (row.kind !== 'consult') continue;
      const c = consultRequestSchema.safeParse(row.value);
      if (c.success && c.data.reviewTokenHash === tokenHash) return structuredClone(c.data);
    }
    return null;
  }

  async remove(caseId: string, kind: CoordinationKind, key: string): Promise<void> {
    this.rows.delete(mapKey(caseId, kind, key));
  }
}

export class PostgresCoordinationStore implements CoordinationStore {
  private get db() { return getDb(); }

  async get<K extends CoordinationKind>(caseId: string, kind: K, key: string): Promise<KindMap[K] | null> {
    const [row] = await this.db.select({ data: coordinationRecords.data }).from(coordinationRecords)
      .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, kind), eq(coordinationRecords.key, key))).limit(1);
    return row ? parse(kind, row.data) : null;
  }

  async list<K extends CoordinationKind>(caseId: string, kind: K): Promise<KindMap[K][]> {
    const rows = await this.db.select({ data: coordinationRecords.data }).from(coordinationRecords)
      .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, kind)));
    return rows.map(r => parse(kind, r.data)).filter((v): v is KindMap[K] => v !== null);
  }

  async save<K extends CoordinationKind>(caseId: string, kind: K, key: string, value: KindMap[K], expectedVersion?: number): Promise<KindMap[K] | null> {
    const valid = parse(kind, value);
    if (!valid) return null;
    const values = {
      version: versionOf(valid),
      tokenHash: tokenHashOf(kind, valid),
      data: valid as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    };
    if (expectedVersion !== undefined) {
      const rows = await this.db.update(coordinationRecords).set(values)
        .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, kind), eq(coordinationRecords.key, key), eq(coordinationRecords.version, expectedVersion)))
        .returning({ key: coordinationRecords.key });
      return rows.length === 1 ? valid : null;
    }
    await this.db.insert(coordinationRecords)
      .values({ caseId, kind, key, ...values })
      .onConflictDoUpdate({ target: [coordinationRecords.caseId, coordinationRecords.kind, coordinationRecords.key], set: values });
    return valid;
  }

  async consultByTokenHash(tokenHash: string): Promise<ConsultRequest | null> {
    const [row] = await this.db.select({ data: coordinationRecords.data }).from(coordinationRecords)
      .where(and(eq(coordinationRecords.kind, 'consult'), eq(coordinationRecords.tokenHash, tokenHash))).limit(1);
    return row ? parse('consult', row.data) : null;
  }

  async remove(caseId: string, kind: CoordinationKind, key: string): Promise<void> {
    await this.db.delete(coordinationRecords)
      .where(and(eq(coordinationRecords.caseId, caseId), eq(coordinationRecords.kind, kind), eq(coordinationRecords.key, key)));
  }
}

const g = globalThis as typeof globalThis & { __wayfinderCoordinationStore?: CoordinationStore };

export function getCoordinationStore(): CoordinationStore {
  g.__wayfinderCoordinationStore ??= process.env.DATABASE_URL ? new PostgresCoordinationStore() : new MemoryCoordinationStore();
  return g.__wayfinderCoordinationStore;
}

/** Test helper: inject (or clear with undefined) the singleton. */
export function setCoordinationStoreForTests(store: CoordinationStore | undefined): void {
  if (store) g.__wayfinderCoordinationStore = store;
  else delete g.__wayfinderCoordinationStore;
}
