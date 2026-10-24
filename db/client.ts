import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/** Neon's HTTP driver has no timeout of its own: a stalled endpoint would hold the request until the platform kills it. */
export const DB_CALL_TIMEOUT_MS = 25_000;
const fetchWithTimeout: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_CALL_TIMEOUT_MS) });

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  neonConfig.fetchFunction = fetchWithTimeout;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to open the database");
  }
  return drizzle(neon(databaseUrl), { schema });
}

let cached: ReturnType<typeof createDb> | undefined;

export function getDb() {
  cached ??= createDb();
  return cached;
}
