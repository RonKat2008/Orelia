import { NextResponse } from "next/server";
import type { ShortlistItem, ShortlistMeta } from "@/lib/agents/persist";
import { getCurationStore, curationKey } from "@/lib/agents/curator-store";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";
import { guardCase } from "@/lib/auth/ownership";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/shortlist -> candidates (rank, score, breakdown, evidence urls) grouped by resource kind. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const { cases, persist } = getServices();
    const found = await cases.get(id);
    if (!found) return jsonError(404, "Case not found");

    const items = await persist.getShortlist(id);
    const meta: ShortlistMeta[] = persist.getShortlistMeta ? await persist.getShortlistMeta(id) : [];
    const metaByKey = new Map(meta.map((row) => [curationKey(row.targetKind, row.targetId), row]));
    let curation: Awaited<ReturnType<ReturnType<typeof getCurationStore>["load"]>> = null;
    try {
      curation = await getCurationStore().load(id);
    } catch {
      curation = null; // curation is additive; never fail the shortlist because of it
    }
    const groups: Record<string, Array<ShortlistItem & {
      tier: string;
      tierReasons: { text: string; evidenceIds: string[] }[];
      caseCandidateId: string | null;
      nctId: string | null;
      organizationKind: "advocacy" | "financial_aid" | "travel_aid" | null;
    }>> = {
      expert: [], institution: [], trial: [], organization: [],
    };
    for (const item of items) {
      const key = curationKey(item.targetKind, item.targetId);
      const c = curation?.byTarget.get(key);
      const extra = metaByKey.get(key);
      (groups[item.targetKind] ??= []).push({
        ...item,
        tier: c?.tier ?? "backup",
        tierReasons: c?.tierReasons ?? [],
        caseCandidateId: extra?.caseCandidateId ?? null,
        nctId: extra?.nctId ?? null,
        organizationKind: extra?.organizationKind ?? null,
      });
    }
    for (const list of Object.values(groups)) list.sort((a, b) => a.rank - b.rank);

    const byKey = new Map(items.map((i) => [curationKey(i.targetKind, i.targetId), i]));
    const suggested = (curation?.suggested ?? [])
      .map((k) => byKey.get(k))
      .filter((i): i is ShortlistItem => !!i && curation?.byTarget.get(curationKey(i.targetKind, i.targetId))?.tier === "best")
      .slice(0, 5)
      .map((i) => ({ targetKind: i.targetKind, targetId: i.targetId, name: i.name }));

    return NextResponse.json({ caseId: id, status: found.status, groups, curationSummary: curation?.summary ?? null, suggested });
  } catch (error) {
    return jsonError(500, "Unable to load shortlist", error);
  }
}
