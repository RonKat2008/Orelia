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

function isOfflinePreview(): boolean {
  return ["1", "true"].includes((process.env.NEXT_PUBLIC_WAYFINDER_OFFLINE ?? "").trim().toLowerCase());
}

/** The server declined the report as outside Wayfinder's scope (a child, or a patient outside the US). */
export class ScopeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeRefusal";
  }
}

/** The server rejected these case fields (paths such as "homeState"). */
export class InvalidFields extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid fields: ${fields.join(", ")}`);
    this.name = "InvalidFields";
  }
}

export async function extractCase(reportText: string, fallback: CaseInput): Promise<{ record: Case; preview: boolean }> {
  try {
    const response = await fetch("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportText }),
    });
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === "string") throw new ScopeRefusal(body.error);
    }
    if (response.ok) {
      const body: unknown = await response.json();
      const record = asCase(body, fallback);
      if (record) {
        rememberCase(record);
        return { record, preview: false };
      }
    }
  } catch (error) {
    if (error instanceof ScopeRefusal) throw error;
    // Fall through: only the explicit offline preview may continue without the API.
  }
  if (!isOfflinePreview()) throw new Error("The cases API did not return a case.");
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
  const checked = caseInputSchema.safeParse(record);
  if (!checked.success) {
    throw new InvalidFields([...new Set(checked.error.issues.map((issue) => String(issue.path[0] ?? "")).filter(Boolean))]);
  }
  const input = checked.data;
  rememberCase({ ...record, ...input, status: "confirmed" });
  const offline = isOfflinePreview();
  const patch = await fetch(`/api/cases/${record.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: input }),
  }).catch(() => undefined);
  if (!offline && patch?.status === 400) {
    const body = (await patch.json().catch(() => null)) as { fields?: unknown } | null;
    const fields = Array.isArray(body?.fields) ? body.fields.filter((f): f is string => typeof f === "string") : [];
    if (fields.length > 0) throw new InvalidFields(fields.map((f) => f.replace(/^fields\./, "")));
  }
  if (!offline && !patch?.ok) throw new Error("The case details were not saved.");
  const research = await fetch(`/api/cases/${record.id}/research`, { method: "POST" }).catch(() => undefined);
  if (!offline && !research?.ok) throw new Error("The search did not start.");
}
