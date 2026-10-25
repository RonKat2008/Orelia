import { rejectCrossOrigin } from "@/lib/auth/origin";
import { requireCaseOwner } from "@/lib/auth/ownership";
import { fail, json } from "@/lib/accounts/http";
import { draftScopeOf, scopeForCase } from "@/lib/accounts/scope";
import { getAccountStore } from "@/lib/accounts/store";
import { parseId } from "../../../_lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST -> moves this browser's draft documents (added on /start) into the case's document space. */
export async function POST(req: Request, { params }: Ctx) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  const id = parseId((await params).id);
  if (!id) return fail(400, "invalid_case");
  const access = await requireCaseOwner(req, id);
  if (!access.ok) return access.response;
  const draft = draftScopeOf(req);
  if (!draft) return json({ moved: 0 });
  try {
    return json({ moved: await getAccountStore().moveScope(draft, await scopeForCase(id)) });
  } catch (err) {
    return fail(500, "adopt_failed", undefined, err);
  }
}
