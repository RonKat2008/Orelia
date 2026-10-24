import { after, NextResponse } from "next/server";
import { isOffline } from "@/lib/env";
import { inngest } from "@/lib/workflows/inngest";
import { RESEARCH_EVENT, RESEARCH_STARTABLE, executeResearch, failResearch } from "@/lib/workflows/research-workflow";
import { jsonError, parseId } from "../../_lib/http";
import { getResearchWiring } from "../../_lib/research-wiring";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Claim first; durable delivery when configured, in-process replay for the offline demo. */
export async function POST(_req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const services = getServices();
  const found = await services.cases.get(id);
  if (!found) return jsonError(404, "Case not found");
  if (!RESEARCH_STARTABLE.some((status) => status === found.status)) {
    return jsonError(409, `Case must be confirmed before research (status: ${found.status})`);
  }

  if (!await services.cases.compareAndSetStatus(id, RESEARCH_STARTABLE, "researching")) {
    return jsonError(409, "Research is already running for this case");
  }

  if (!isOffline(process.env.WAYFINDER_OFFLINE) && process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY) {
    try {
      await inngest.send({ name: RESEARCH_EVENT, data: { caseId: id } });
    } catch (e) {
      await failResearch(id, services);
      console.error(`[research ${id}] event delivery failed`, e instanceof Error ? e.message : e);
      return jsonError(503, "Could not queue research; please retry");
    }
  } else {
    after(async () => {
      try {
        const wiring = await getResearchWiring();
        await executeResearch(id, {
          store: services.runs,
          persist: services.persist,
          cases: services.cases,
          ports: wiring.ports,
          agents: wiring.agents,
        }, { run: (_id, work) => work() });
      } catch (e) {
        await failResearch(id, services);
        console.error(`[research ${id}]`, e instanceof Error ? e.message : e);
      }
    });
  }
  return NextResponse.json({ caseId: id, status: "researching" }, { status: 202 });
}
