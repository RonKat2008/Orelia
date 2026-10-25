import { requireCaseOwner } from "@/lib/auth/ownership";
import { fail, json } from "@/lib/accounts/http";
import { getDocumentUseStore } from "@/lib/accounts/uses";
import { parseId } from "../../../_lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET -> which of the patient's documents each agent read for this case (titles only, never text). */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return fail(400, "invalid_case");
  const access = await requireCaseOwner(req, id);
  if (!access.ok) return access.response;
  try {
    const byAgent = new Map<string, { id: string; title: string }[]>();
    for (const u of await getDocumentUseStore().list(id)) {
      byAgent.set(u.agent, [...(byAgent.get(u.agent) ?? []), { id: u.documentId, title: u.title }]);
    }
    return json({ uses: [...byAgent].map(([agent, documents]) => ({ agent, documents })) });
  } catch (err) {
    return fail(500, "usage_unavailable", undefined, err);
  }
}
