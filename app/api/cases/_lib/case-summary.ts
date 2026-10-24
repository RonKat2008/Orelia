import { ingestCaseSummary } from "@/lib/case-docs";

/** Index the case fields for agents; a failed ingest is logged and never fails the request. */
export async function ingestSummarySafely(caseRecord: { id: string; [field: string]: unknown }): Promise<void> {
  try {
    await ingestCaseSummary(caseRecord);
  } catch (e) {
    console.error(`[case-docs ${caseRecord.id}] summary ingest failed`, e instanceof Error ? e.name : "unknown");
  }
}
