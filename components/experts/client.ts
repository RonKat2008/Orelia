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

export const getExperts = (caseId: string, f: Fetch = fetch) => call(f, caseId);
export const traceExperts = (caseId: string, f: Fetch = fetch) =>
  call(f, caseId, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
