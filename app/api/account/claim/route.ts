import { readSession } from "@/lib/auth/session";
import { fail, json, requireAccount } from "@/lib/accounts/http";
import { claimCases } from "@/lib/accounts/lifecycle";

export const runtime = "nodejs";

/** POST /api/account/claim -> attaches this browser's anonymous cases to the signed-in account. */
export async function POST(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  try {
    return json({ claimed: await claimCases(readSession(req), guard.account.id) });
  } catch (err) {
    return fail(500, "claim_failed", undefined, err);
  }
}
