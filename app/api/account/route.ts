import { accountsEnabled } from "@/lib/auth/neon";
import { currentAccount } from "@/lib/accounts/current";
import { clearSessionCookies, fail, json, readJson, requireAccount } from "@/lib/accounts/http";
import { deleteAccount } from "@/lib/accounts/lifecycle";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/account -> { enabled, account } */
export async function GET(req: Request) {
  const enabled = accountsEnabled();
  const account = enabled ? await currentAccount(req) : null;
  return json({ enabled, account });
}

/** DELETE /api/account { confirm: "DELETE" } -> removes everything the account owns, then the account itself. */
export async function DELETE(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!body.ok) return body.response;
  if ((body.value as { confirm?: unknown } | null)?.confirm !== "DELETE") return fail(400, "confirm_required", 'Type DELETE to confirm');
  try {
    const summary = await deleteAccount(guard.account.id);
    return clearSessionCookies(json({ ok: true, ...summary }), SESSION_COOKIE);
  } catch (err) {
    return fail(500, "delete_failed", "We could not delete everything. Please try again.", err);
  }
}
