import { fail, json, readJson, requireAccount } from "@/lib/accounts/http";
import { validateProfile } from "@/lib/accounts/profile";
import { getAccountStore } from "@/lib/accounts/store";

export const runtime = "nodejs";

/** GET /api/account/profile -> { profile | null } */
export async function GET(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  try {
    return json({ profile: await getAccountStore().getProfile(guard.account.id) });
  } catch (err) {
    return fail(500, "profile_unavailable", undefined, err);
  }
}

/** PUT /api/account/profile Profile -> { profile } | 422 invalid | 422 adult_only */
export async function PUT(req: Request) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const result = validateProfile(body.value);
  if (!result.ok) {
    return json(result.error === "adult_only" ? { error: result.error, message: result.message } : { error: result.error, issues: result.issues }, 422);
  }
  try {
    await getAccountStore().putProfile(guard.account.id, result.profile);
    return json({ profile: result.profile });
  } catch (err) {
    return fail(500, "profile_save_failed", undefined, err);
  }
}
