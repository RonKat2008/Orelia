import { NextResponse } from "next/server";
import type { ShortlistItem, ShortlistMeta } from "@/lib/agents/persist";
import type { OrganizationKind } from "@/lib/contracts";
import { getCurationStore, curationKey } from "@/lib/agents/curator-store";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";
import { guardCase } from "@/lib/auth/ownership";
import { isReachable } from "@/lib/outreach/reachability";

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
    // One parallel round (was four sequential reads); a missing case still answers 404.
    const [found, items, meta, curation] = await Promise.all([
      cases.get(id),
      persist.getShortlist(id),
      persist.getShortlistMeta ? persist.getShortlistMeta(id) : Promise.resolve([] as ShortlistMeta[]),
      // curation is additive; never fail the shortlist because of it
      getCurationStore().load(id).catch(() => null),
    ]);
    if (!found) return jsonError(404, "Case not found");
    const metaByKey = new Map(meta.map((row) => [curationKey(row.targetKind, row.targetId), row]));
    const groups: Record<string, Array<ShortlistItem & {
      tier: string;
      tierReasons: { text: string; evidenceIds: string[] }[];
      caseCandidateId: string | null;
      nctId: string | null;
      organizationKind: OrganizationKind | null;
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
      // The judge's suggested list is already curated (keeps, by tier then score); only an excluded pick is skipped.
      .filter((i): i is ShortlistItem => !!i && (curation?.byTarget.get(curationKey(i.targetKind, i.targetId))?.tier ?? "exclude") !== "exclude")
      // Never pre-check a resource with no contact route (also covers curations stored before this rule).
      .filter((i) => isReachable(i.evidence))
      .slice(0, 5)
      .map((i) => ({ targetKind: i.targetKind, targetId: i.targetId, name: i.name }));

    return NextResponse.json({ caseId: id, status: found.status, groups, curationSummary: curation?.summary ?? null, suggested });
  } catch (error) {
    return jsonError(500, "Unable to load shortlist", error);
  }
}
