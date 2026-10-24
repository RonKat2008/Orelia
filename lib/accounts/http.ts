import { rejectCrossOrigin } from "@/lib/auth/origin";
import { currentAccount } from "./current";
import type { Account } from "./contract";

export const noStore = { "Cache-Control": "no-store" } as const;

export type AccountGuard = { ok: true; account: Account } | { ok: false; response: Response };

/**
 * Account routes: CSRF first for state-changing methods, then a signed-in account. Signed out gets the same opaque
 * 404 as every other owner-only route (the UI learns sign-in state from GET /api/account).
 */
export async function requireAccount(req: Request): Promise<AccountGuard> {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return { ok: false, response: csrf };
  const account = await currentAccount(req);
  if (!account) return { ok: false, response: Response.json({ error: "Not found" }, { status: 404, headers: noStore }) };
  return { ok: true, account };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}
/** Error response that never echoes request content. `err` is logged by name only (no PHI). */
export function fail(status: number, error: string, message?: string, err?: unknown): Response {
  if (err !== undefined) console.error(`[accounts ${status}] ${error}`, err instanceof Error ? err.name : "error");
  return json(message ? { error, message } : { error }, status);
}
export async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, response: fail(400, "invalid_json", "Body must be valid JSON") };
  }
}
