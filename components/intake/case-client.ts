import { caseInputSchema, caseSchema, type Case, type CaseInput } from "@/lib/contracts";

const STORAGE_PREFIX = "wayfinder.case.";

export function rememberCase(record: Case) {
  sessionStorage.setItem(STORAGE_PREFIX + record.id, JSON.stringify(record));
}

export function recallCase(id: string): Case | null {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + id);
  if (!raw) return null;
  const parsed = caseSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** POST /api/cases answers { case: {...} }; accept a bare case too. */
function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "case" in value) return (value as { case: unknown }).case;
  return value;
}

function asCase(body: unknown, fallback: CaseInput): Case | null {
  const value = unwrap(body);
  const full = caseSchema.safeParse(value);
  if (full.success) return full.data;
  const input = caseInputSchema.safeParse(value);
  if (!input.success) return null;
  return {
    ...fallback,
    ...input.data,
    id: crypto.randomUUID(),
    status: "extracted",
    createdAt: new Date().toISOString(),
  };
}

export async function extractCase(reportText: string, fallback: CaseInput): Promise<{ record: Case; preview: boolean }> {
  try {
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportText }),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      const record = asCase(body, fallback);
      if (record) {
        rememberCase(record);
        return { record, preview: false };
      }
    }
  } catch {
    // The cases API is owned by the agents task and may not be running yet.
  }
  const local = caseSchema.parse({
    ...fallback,
    id: crypto.randomUUID(),
    status: "extracted",
    createdAt: new Date().toISOString(),
  });
  rememberCase(local);
  return { record: local, preview: true };
}

export async function confirmAndResearch(record: Case): Promise<void> {
  const input = caseInputSchema.parse(record);
  rememberCase({ ...record, ...input, status: "confirmed" });
  await fetch(`/api/cases/${record.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => undefined);
  await fetch(`/api/cases/${record.id}/research`, { method: "POST" }).catch(() => undefined);
}
