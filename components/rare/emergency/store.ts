import { emergencyRecordSchema, type EmergencyRecord } from "@/lib/rare-disease/emergency/contract";
import { emptyRecord } from "@/lib/rare-disease/emergency/approval";

/** The slice of Storage we use, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export const emergencyKey = (caseId: string): string => `wayfinder:emergency-card:${caseId}`;

/**
 * Per-case emergency record kept in this browser only (no database table). A missing, broken or tampered value
 * reads as a fresh, unapproved record.
 */
export function loadRecord(store: KeyValueStore | null, caseId: string, now: Date): EmergencyRecord {
  try {
    const raw = store?.getItem(emergencyKey(caseId));
    if (raw) {
      const parsed = emergencyRecordSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* storage blocked or bad JSON: start fresh */
  }
  return emptyRecord(now);
}

/** True when the record was saved. A blocked or full store returns false so the page can say so. */
export function saveRecord(store: KeyValueStore | null, caseId: string, record: EmergencyRecord): boolean {
  try {
    if (!store) return false;
    store.setItem(emergencyKey(caseId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
