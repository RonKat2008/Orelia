import { expertsResponseSchema, type ExpertTrace } from "@/lib/experts/contract";

export type ExpertsResult =
  | { ok: true; trace: ExpertTrace | null }
  | { ok: false; status: number; message: string };

type Fetch = typeof fetch;

const url = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/experts`;

async function read(res: Response): Promise<ExpertsResult> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok) {
    const parsed = expertsResponseSchema.safeParse(body);
    return parsed.success
      ? { ok: true, trace: parsed.data.trace }
      : { ok: false, status: 502, message: "The trace came back in an unexpected shape." };
  }
  const error = (body as { error?: unknown } | null)?.error;
  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? (error as { message: string }).message
        : "Something went wrong. Nobody was contacted.";
  return { ok: false, status: res.status, message };
}

async function call(f: Fetch, caseId: string, init?: RequestInit): Promise<ExpertsResult> {
  try {
    return await read(await f(url(caseId), { credentials: "same-origin", ...init }));
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Nobody was contacted." };
  }
}

export type RefreshResult =
  | { ok: true; trace: ExpertTrace | null; added: { affiliations: number; contactPoints: number } }
  | { ok: false; status: number; message: string };

const addedOf = (body: unknown): { affiliations: number; contactPoints: number } => {
  const a = (body as { added?: { affiliations?: unknown; contactPoints?: unknown } } | null)?.added;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { affiliations: n(a?.affiliations), contactPoints: n(a?.contactPoints) };
};

/** Re-runs only the identity / contact-point stamping and the trace for this case. Contacts nobody. */
export async function refreshResearch(caseId: string, f: Fetch = fetch): Promise<RefreshResult> {
  try {
    const res = await f(`${url(caseId)}/refresh`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    if (res.status === 429) return { ok: false, status: 429, message: "Research was refreshed recently. Try again in a little while." };
    const clone = res.clone();
    const base = await read(res);
    if (!base.ok) return base;
    let body: unknown = null;
    try { body = await clone.json(); } catch { body = null; }
    return { ok: true, trace: base.trace, added: addedOf(body) };
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server. Nobody was contacted." };
  }
}

export const getExperts = (caseId: string, f: Fetch = fetch) => call(f, caseId);
export const traceExperts = (caseId: string, f: Fetch = fetch) =>
  call(f, caseId, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
