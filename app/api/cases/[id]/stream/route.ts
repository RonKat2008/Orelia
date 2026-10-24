import { requireCaseOwner } from "@/lib/auth/ownership";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 1000;
const MAX_STREAM_MS = 280_000;
const EXPECTED_AGENTS = 9;
const TERMINAL_RUN = new Set(["done", "failed", "not_implemented"]);
const TERMINAL_CASE = new Set(["ready", "research_failed"]);

/**
 * GET /api/cases/[id]/stream -> SSE. 'runs' events carry an agent_runs snapshot every ~1s;
 * a final 'done' event is sent once all agents are terminal AND the case has been persisted.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const owner = await requireCaseOwner(req, id);
    if (!owner.ok) return owner.response;
    const { cases, runs } = getServices();
    if (!(await cases.get(id))) return jsonError(404, "Case not found");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        const deadline = Date.now() + MAX_STREAM_MS;
        try {
          while (!req.signal.aborted && Date.now() < deadline) {
            const [snapshot, current] = await Promise.all([runs.listByCase(id), cases.get(id)]);
            send("runs", { caseId: id, caseStatus: current?.status, runs: snapshot });
            const allTerminal =
              snapshot.length >= EXPECTED_AGENTS && snapshot.every((r) => TERMINAL_RUN.has(r.status));
            if (allTerminal && current && TERMINAL_CASE.has(current.status)) {
              send("done", { caseId: id, caseStatus: current.status });
              break;
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
          }
        } catch (e) {
          console.error("[stream] Unable to load research progress", e);
          send("error", { message: "Unable to load research progress" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return jsonError(500, "Unable to process request", error);
  }
}
