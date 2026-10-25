import { caseInputSchema, caseSchema, REPORT_TEXT_MIN, REPORT_TEXT_MAX, type Case, type CaseInput } from "@/lib/contracts";

const STORAGE_PREFIX = "wayfinder.case.";

/** The API owns case data; browser storage is only an optional cache. */
export function rememberCase(record: Case) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + record.id, JSON.stringify(record));
  } catch {
    // Private browsing, storage quotas and browser policies must not block intake.
  }
}

export function recallCase(id: string): Case | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = caseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === "object" && "case" in value) return (value as { case: unknown }).case;
  return value;
}

/** A report explicitly outside the supported population. */
export class ScopeRefusal extends Error {
  constructor(message: string) { super(message); this.name = "ScopeRefusal"; }
}

export class InvalidFields extends Error {
  constructor(public readonly fields: string[]) {
    super(`Check these details: ${fields.join(", ")}.`);
    this.name = "InvalidFields";
  }
}

type Operation = "read" | "save" | "research";

/** Keep errors actionable without exposing provider responses or patient data. */
function requestError(response: Response, operation: Operation): Error {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return new Error(Number.isFinite(seconds) && seconds > 0
      ? `Too many search requests. Try again in ${Math.ceil(seconds)} seconds.`
      : "Too many requests. Please wait a moment and try again.");
  }
  if (response.status === 403) return new Error("Your request could not be verified. Reload this page and allow cookies for Wayfinder, then try again.");
  if (response.status === 404) return new Error("This case is unavailable in your current browser session. Start a new case from the report.");
  if (response.status === 409) return new Error("Research is already running for this case. Open your case to follow its progress.");
  if (response.status === 400) return new Error(operation === "read"
    ? "Use between 20 and 60,000 characters of report text."
    : "Some case details are invalid. Check the diagnosis and travel limit, then try again.");
  return new Error(operation === "read"
    ? "The report-reading service is unavailable. Your report is still here; please try again shortly."
    : operation === "save"
      ? "Your details could not be saved. They are still here; please try again."
      : "Your details were saved, but research could not start. Please try starting the search again.");
}

async function send(url: string, init: RequestInit, operation: Operation): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(operation === "read" ? 120_000 : 30_000) });
  } catch {
    throw new Error(operation === "research"
      ? "Your details were saved, but we could not connect to start research. Check your connection and try again."
      : "We could not connect to Wayfinder. Check your connection and try again; your details are still here.");
  }
}

async function failure(response: Response, operation: Operation): Promise<Error> {
  if (response.status === 400 || response.status === 422) {
    const body = await response.json().catch(() => null) as { fields?: unknown; error?: unknown } | null;
    if (response.status === 422 && typeof body?.error === "string") return new ScopeRefusal(body.error);
    if (operation === "save" && Array.isArray(body?.fields)) {
      const fields = body.fields.filter((value): value is string => typeof value === "string");
      if (fields.length) return new InvalidFields(fields.map((value) => value.replace(/^fields\./, "")));
    }
  }
  return requestError(response, operation);
}

export async function extractCase(reportText: string, fallback: CaseInput): Promise<{ record: Case; preview: boolean }> {
  // Retained for callers that prepare a review draft; never invent an unsaved case ID.
  void fallback;
  const length = reportText.trim().length;
  if (length < REPORT_TEXT_MIN || length > REPORT_TEXT_MAX) throw new Error(`Use between ${REPORT_TEXT_MIN} and ${REPORT_TEXT_MAX.toLocaleString("en-US")} characters of report text.`);
  const response = await send("/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reportText }),
  }, "read");
  if (!response.ok) throw await failure(response, "read");
  const body: unknown = await response.json().catch(() => null);
  const parsed = caseSchema.safeParse(unwrap(body));
  if (!parsed.success) throw new Error("Wayfinder returned an incomplete case. Your report is still here; please try reading it again.");
  rememberCase(parsed.data);
  return { record: parsed.data, preview: false };
}

const OPTIONAL_FIELDS = ["diseaseCodes", "subtype", "stageSummary", "homeCity", "homeState", "insurer", "planId", "travelLimitMiles"] as const;

async function researchAlreadyStarted(id: string): Promise<boolean> {
  const response = await send(`/api/cases/${id}`, {}, "research");
  if (!response.ok) return false;
  const parsed = caseSchema.safeParse(unwrap(await response.json().catch(() => null)));
  return parsed.success && ["researching", "ready"].includes(parsed.data.status);
}

export async function confirmAndResearch(record: Case): Promise<void> {
  const parsed = caseInputSchema.safeParse(record);
  if (!parsed.success || !parsed.data.diseaseName.trim()) {
    throw new InvalidFields(parsed.success ? ["diseaseName"] : [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")).filter(Boolean))]);
  }
  const input = { ...parsed.data, diseaseName: parsed.data.diseaseName.trim() };
  const fields = { ...input, ...Object.fromEntries(OPTIONAL_FIELDS.map((key) => [key, input[key] ?? null])) };
  const patch = await send(`/api/cases/${record.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  }, "save");
  // A response can be lost after the server starts research; retrying must resume it.
  if (patch.status === 409 && await researchAlreadyStarted(record.id)) return;
  if (!patch.ok) throw await failure(patch, "save");
  rememberCase({ ...record, ...input, status: "confirmed" });
  const research = await send(`/api/cases/${record.id}/research`, { method: "POST" }, "research");
  if (research.status === 409 && await researchAlreadyStarted(record.id)) return;
  if (!research.ok) throw await failure(research, "research");
  rememberCase({ ...record, ...input, status: "researching" });
}
