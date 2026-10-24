import { rejectCrossOrigin } from "@/lib/auth/origin";
import { accountsEnabled, getNeonAuth } from "@/lib/auth/neon";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { json } from "@/lib/accounts/http";

export const runtime = "nodejs";

/**
 * POST /api/account/sign-out: ends the account session AND drops the anonymous session cookie, so the next person on
 * this browser cannot reach the signed-out account's cases through the legacy owner session.
 */
export async function POST(req: Request) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  if (accountsEnabled()) {
    try {
      await (await getNeonAuth()).signOut();
    } catch (err) {
      console.error("[accounts] sign-out failed", err instanceof Error ? err.name : "error");
    }
  }
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return res;
}
