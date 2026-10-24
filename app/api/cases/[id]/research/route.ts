import { after, NextResponse } from "next/server";
import { runResearch } from "@/lib/agents/orchestrator";
import { placeholderRank } from "@/lib/agents/placeholder-rank";
import { jsonError, parseId } from "../../_lib/http";
import { getResearchWiring } from "../../_lib/research-wiring";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const STARTABLE = new Set(["confirmed", "ready", "research_failed"]);

/**
 * POST /api/cases/[id]/research -> 202 immediately; research continues after the response.
 * M1 note: this is fire-and-forget via next/server `after()` (keeps the function alive until it settles, up to
 * maxDuration). Progress is observable via the SSE stream / agent_runs. M3 should move this to an Inngest job.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const services = getServices();
  const found = await services.cases.get(id);
  if (!found) return jsonError(404, "Case not found");
  if (!STARTABLE.has(found.status)) {
    return jsonError(409, `Case must be confirmed before research (status: ${found.status})`);
  }

  const wiring = await getResearchWiring();
  // Claim the case before responding so a double-click cannot start two swarms.
  await services.cases.setStatus(id, "researching");
  after(async () => {
    try {
      await runResearch(id, {
        store: services.runs,
        persist: services.persist,
        cases: services.cases,
        rank: wiring.rank ?? placeholderRank,
        ports: wiring.ports,
        agents: wiring.agents,
      });
    } catch (e) {
      console.error(`[research ${id}]`, e instanceof Error ? e.message : e);
    }
  });
  return NextResponse.json({ caseId: id, status: "researching" }, { status: 202 });
}
