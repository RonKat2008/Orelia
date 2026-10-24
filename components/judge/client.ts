import { careNeedsSchema, type CareNeeds } from "@/lib/contracts/care-needs";
import { judgeResultSchema, type JudgeResult } from "@/lib/contracts/judge";

export type NeedsJudgeResult =
  | { ok: true; needs: CareNeeds | null; judge: JudgeResult | null }
  | { ok: false; message: string };

const GENERIC = "Something went wrong. Nothing was changed.";

function errorMessage(body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  const nested = (error as { message?: unknown } | null)?.message;
  return typeof nested === "string" ? nested : GENERIC;
}

/** GET the case's needs profile and judge verdicts. Either may be null when not built yet. */
export async function loadNeedsJudge(caseId: string, f: typeof fetch = fetch): Promise<NeedsJudgeResult> {
  let res: Response;
  try {
    res = await f(`/api/cases/${encodeURIComponent(caseId)}/judge`, { credentials: "same-origin" });
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 404) return { ok: true, needs: null, judge: null };
  if (!res.ok) return { ok: false, message: errorMessage(body) };
  const raw = (body ?? {}) as { needs?: unknown; judge?: unknown };
  const needs = careNeedsSchema.safeParse(raw.needs);
  const judge = judgeResultSchema.safeParse(raw.judge);
  return { ok: true, needs: needs.success ? needs.data : null, judge: judge.success ? judge.data : null };
}
