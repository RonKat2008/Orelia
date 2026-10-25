import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { getNeedsStore } from "@/lib/agents/needs/store";
import { getHistoryStore } from "@/lib/history";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A store that fails reads as "nothing yet": the card then has fewer lines, never wrong ones. */
async function orElse<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

/**
 * GET /api/cases/[id]/emergency -> the raw inputs for the emergency card: sourced emergency facts, history events
 * and documents (titles only). The page filters them with lib/rare-disease/emergency; nothing is stored here.
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    const found = await getServices().cases.get(id);
    if (!found) return jsonError(404, "Case not found");
    const undiagnosed = found.undiagnosed === true;
    const [needs, events, documents] = await Promise.all([
      orElse(() => getNeedsStore().loadNeeds(id), null),
      orElse(() => getHistoryStore().listEvents(id), []),
      orElse(() => getHistoryStore().listDocuments(id), []),
    ]);
    return NextResponse.json(
      {
        undiagnosed,
        condition: undiagnosed ? null : found.diseaseName,
        needs: needs ? { emergencyFacts: needs.emergencyFacts, sources: needs.sources } : null,
        events,
        documents: documents.map((d) => ({ id: d.id, title: d.title })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return jsonError(500, "Unable to load the emergency card", err);
  }
}
