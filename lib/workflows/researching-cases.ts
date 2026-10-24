import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { cases } from "@/db/schema";

/** Ids of cases whose research is in flight (input to the watchdog sweep). */
export async function listResearchingCaseIds(): Promise<string[]> {
  const rows = await getDb().select({ id: cases.id }).from(cases).where(eq(cases.status, "researching"));
  return rows.map((r) => r.id);
}
