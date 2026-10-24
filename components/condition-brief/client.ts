import { conditionBriefSchema, type ConditionBrief } from "@/lib/condition-brief/contract";

export type BriefResult =
  | { ok: true; brief: ConditionBrief | null }
  | { ok: false; status: number; message: string };

type Fetch = typeof fetch;

const url = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/condition-brief`;
const GENERIC = "Something went wrong. Nothing was changed.";

async function read(res: Response): Promise<BriefResult> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 404) return { ok: true, brief: null };
  if (res.ok) {
    if ((body as { brief?: unknown } | null)?.brief === null) return { ok: true, brief: null };
    const parsed = conditionBriefSchema.safeParse((body as { brief?: unknown } | null)?.brief);
    if (parsed.success) return { ok: true, brief: parsed.data };
    return { ok: false, status: 502, message: "The brief came back in an unexpected shape." };
  }
  const error = (body as { error?: unknown } | null)?.error;
  const message =
    typeof error === "string"
      ? error
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? (error as { message: string }).message
        : GENERIC;
  return { ok: false, status: res.status, message };
}

async function call(f: Fetch, target: string, init?: RequestInit): Promise<BriefResult> {
  try {
    return await read(await f(target, init));
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
}

/** GET the latest brief. `{ok:true, brief:null}` means none has been built yet (200 null, or 404 from an older server). */
export const getBrief = (caseId: string, f: Fetch = fetch) => call(f, `${url(caseId)}?optional=1`);

/** POST to build (refresh=false) or rebuild (refresh=true) the brief. */
export async function buildBrief(caseId: string, refresh: boolean, f: Fetch = fetch): Promise<BriefResult> {
  const result = await call(f, url(caseId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  // A 404 on POST means the case itself was not found, not "no brief yet".
  return result.ok && result.brief === null ? { ok: false, status: 404, message: "We could not find this case." } : result;
}
