import { guardCase } from "@/lib/auth/ownership";
import { liveCallsFor } from "@/lib/outreach/call-live-read";
import { getServices } from "../../../../_lib/services";
import { jsonError, parseId } from "../../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const POLL_MS = 1000;
const MAX_STREAM_MS = 280_000;

/**
 * GET /api/cases/[id]/calls/live/stream[?view=judge] -> SSE. Sends a `calls` event (same payload as
 * /calls/live) on connect and whenever anything changes; closes after ~280 s (EventSource reconnects).
 */
export async function GET(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  try {
    if (!(await getServices().cases.get(id))) return jsonError(404, "Case not found");
  } catch (err) {
    return jsonError(500, "Unable to load calls", err);
  }
  const judge = new URL(req.url).searchParams.get("view") === "judge";
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stopped = () => cancelled || req.signal.aborted;
      const deadline = Date.now() + MAX_STREAM_MS;
      let last = "";
      try {
        while (!stopped() && Date.now() < deadline) {
          const payload = JSON.stringify({ calls: await liveCallsFor(id, judge) });
          if (stopped()) break;
          if (payload !== last) {
            last = payload;
            controller.enqueue(encoder.encode(`event: calls\ndata: ${payload}\n\n`));
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch (e) {
        if (!stopped()) {
          console.error("[calls-stream] Unable to load calls", e instanceof Error ? e.name : "unknown");
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "Unable to load calls" })}\n\n`));
        }
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
