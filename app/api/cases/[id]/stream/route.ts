import { requireCaseOwner } from "@/lib/auth/ownership";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";
import { isFinished, loadProgress } from "@/lib/agents/progress-snapshot";
import { reapIfStuck } from "@/lib/workflows/research-watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 1000;
const MAX_STREAM_MS = 280_000;
/** The lazy stuck-research check runs this often inside one stream (each tick is ~1s). */
const REAP_EVERY_TICKS = 30;

/**
 * GET /api/cases/[id]/stream -> SSE. 'runs' events carry an agent_runs snapshot every ~1s;
 * a final 'done' event is sent once all agents are terminal AND the case has been persisted. Research that
 * went quiet (function killed) is ended by the lazy watchdog check so the stream always reaches a terminal state.
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
    let cancelled = false;
    let wakePoll: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stopped = () => cancelled || req.signal.aborted;
        const send = (event: string, data: unknown) => {
          if (!stopped()) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };
        const onAbort = () => wakePoll?.();
        req.signal.addEventListener("abort", onAbort, { once: true });
        const deadline = Date.now() + MAX_STREAM_MS;
        try {
          let tick = 0;
          while (!stopped() && Date.now() < deadline) {
            if (tick++ % REAP_EVERY_TICKS === 0) await reapIfStuck(id, { cases, runs }).catch(() => undefined);
            if (stopped()) break;
            const progress = await loadProgress(id, { cases, runs });
            if (stopped()) break;
            send("runs", progress);
            if (isFinished(progress)) {
              send("done", { caseId: id, caseStatus: progress.caseStatus });
              break;
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => { wakePoll = undefined; resolve(); }, POLL_MS);
              wakePoll = () => { clearTimeout(timer); wakePoll = undefined; resolve(); };
            });
          }
        } catch (e) {
          if (!stopped()) {
            console.error("[stream] Unable to load research progress", e);
            send("error", { message: "Unable to load research progress" });
          }
        } finally {
          req.signal.removeEventListener("abort", onAbort);
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        wakePoll?.();
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
