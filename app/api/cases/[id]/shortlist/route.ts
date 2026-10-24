import { NextResponse } from "next/server";
import type { ShortlistItem } from "@/lib/agents/persist";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/shortlist -> candidates (rank, score, breakdown, evidence urls) grouped by resource kind. */
export async function GET(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const { cases, persist } = getServices();
  const found = await cases.get(id);
  if (!found) return jsonError(404, "Case not found");

  const items = await persist.getShortlist(id);
  const groups: Record<string, ShortlistItem[]> = { expert: [], institution: [], trial: [], organization: [] };
  for (const item of items) (groups[item.targetKind] ??= []).push(item);
  for (const list of Object.values(groups)) list.sort((a, b) => a.rank - b.rank);

  return NextResponse.json({ caseId: id, status: found.status, groups });
}
