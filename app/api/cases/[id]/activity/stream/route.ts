import { requireCaseOwner } from "@/lib/auth/ownership";
import { loadActivity } from "@/lib/activity/snapshot";
import { jsonError, parseId } from "../../../_lib/http";
import { getServices } from "../../../_lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 1500;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 280_000;

/**
 * GET /api/cases/[id]/activity/stream -> SSE. Event `activity` carries the full snapshot, sent only when its cursor
 * (content hash) changed. Every 15 s a `ping` event (plus an SSE comment) proves the stream is alive; the server closes
 * after ~280 s and the browser reconnects. `?view=judge` includes provider listen URLs.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const owner = await requireCaseOwner(req, id);
    if (!owner.ok) return owner.response;
    if (!(await getServices().cases.get(id))) return jsonError(404, "Case not found");
    const judge = new URL(req.url).searchParams.get("view") === "judge";

    const encoder = new TextEncoder();
    let cancelled = false;
    let wake: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const stopped = () => cancelled || req.signal.aborted;
        const write = (chunk: string) => {
          if (!stopped()) controller.enqueue(encoder.encode(chunk));
        };
        const onAbort = () => wake?.();
        req.signal.addEventListener("abort", onAbort, { once: true });
        const deadline = Date.now() + MAX_STREAM_MS;
        let lastCursor = "";
        let lastSend = Date.now();
        try {
          while (!stopped() && Date.now() < deadline) {
            const snapshot = await loadActivity(id, { judge });
            if (stopped()) break;
            if (snapshot.cursor !== lastCursor) {
              lastCursor = snapshot.cursor;
              write(`event: activity\ndata: ${JSON.stringify(snapshot)}\n\n`);
              lastSend = Date.now();
            } else if (Date.now() - lastSend >= HEARTBEAT_MS) {
              write(`: heartbeat\n\nevent: ping\ndata: {}\n\n`);
              lastSend = Date.now();
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(() => { wake = undefined; resolve(); }, POLL_MS);
              wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
            });
          }
        } catch (e) {
          if (!stopped()) {
            console.error("[activity-stream] Unable to load activity", e instanceof Error ? e.name : "error");
            write(`event: error\ndata: ${JSON.stringify({ message: "Unable to load activity" })}\n\n`);
          }
        } finally {
          req.signal.removeEventListener("abort", onAbort);
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        wake?.();
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
