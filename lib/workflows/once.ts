/**
 * Exactly-once claims for cron work that has no row of its own to lease (e.g. "reply to this demo thread once").
 *
 * Backed by the existing rate_limits table (key primary key): claiming is one INSERT ... ON CONFLICT DO NOTHING
 * RETURNING, so of any number of overlapping cron runs exactly one gets `true`. No migration needed; keys are
 * namespaced (`once:<scope>:<id>`) so they can never collide with rate-limit keys.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';

export interface OnceStore {
  /** True for exactly one caller per key, ever (until release). */
  claim(key: string, now: Date): Promise<boolean>;
  /** Gives the key back (only for work that failed before doing anything visible). */
  release(key: string): Promise<void>;
}

export const onceKey = (scope: string, id: string) => `once:${scope}:${id}`;

export class PostgresOnceStore implements OnceStore {
  async claim(key: string, now: Date): Promise<boolean> {
    const res = await getDb().execute(sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${key}, ${now.toISOString()}::timestamptz, 1)
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as unknown[];
    return rows.length === 1;
  }

  async release(key: string): Promise<void> {
    await getDb().execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
  }
}

export class InMemoryOnceStore implements OnceStore {
  readonly keys = new Set<string>();
  async claim(key: string): Promise<boolean> {
    // Yield first so concurrent callers genuinely interleave in tests.
    await Promise.resolve();
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }
  async release(key: string): Promise<void> {
    this.keys.delete(key);
  }
}
