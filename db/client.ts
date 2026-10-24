import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function createDb(databaseUrl = process.env.DATABASE_URL) {
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
