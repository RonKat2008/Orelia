import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";

/** True when a real database is configured; otherwise the console shows only in-memory (dev) data. */
export const hasDatabase = (): boolean => Boolean(process.env.DATABASE_URL);

/** Runs raw SQL and returns rows, whatever shape the driver wraps them in. */
export async function queryRows<T>(query: SQL): Promise<T[]> {
  const result: unknown = await getDb().execute(query);
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

const TABLE_TTL_MS = 30_000;
const tableCache = new Map<string, { at: number; present: boolean }>();

/** `to_regclass('public.<name>')` probe, cached briefly so a 1.5 s poll does not add a query per tick. Never throws. */
export async function tableExists(name: string, now: number = Date.now()): Promise<boolean> {
  const cached = tableCache.get(name);
  if (cached && now - cached.at < TABLE_TTL_MS) return cached.present;
  let present = false;
  try {
    const rows = await queryRows<{ t: string | null }>(sql`select to_regclass(${`public.${name}`})::text as t`);
    present = Boolean(rows[0]?.t);
  } catch {
    present = false;
  }
  tableCache.set(name, { at: now, present });
  return present;
}

export function resetTableCache(): void {
  tableCache.clear();
}

export const isoOrNull = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
