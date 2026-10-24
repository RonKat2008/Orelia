import { requireCaseOwner } from "@/lib/auth/ownership";
import { statusKey } from "@/lib/patient-status/status";
import { jsonError, parseId } from "../../../_lib/http";
import { buildPatientStatusBody, loadPatientSnapshot, timeZoneFrom } from "../../../_lib/patient-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** While agents work, check often; while waiting on people (replies take days), check gently. */
const WORKING_MS = 2000;
const YOUR_TURN_MS = 4000;
const WAITING_MS = 15_000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 280_000;

/**
 * GET /api/cases/[id]/patient-status/stream -> SSE. A 'status' event carries the patient status body whenever
 * what the patient sees changes. The stream ends before the function limit; EventSource reconnects on its own
 * (retry hint 2s) and the page falls back to polling GET /patient-status if the stream keeps failing.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const owner = await requireCaseOwner(req, id);
    if (!owner.ok) return owner.response;
    const first = await loadPatientSnapshot(id);
    if (!first.found) return jsonError(404, "Case not found");
    const timeZone = timeZoneFrom(req);

    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };
        const send = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        const deadline = Date.now() + MAX_STREAM_MS;
        const cache: { shortlistTotal?: number } = {};
        let lastKey = "";
        let lastBeat = Date.now();
        let snapshot = first;
        write("retry: 2000\n\n");
        try {
          while (!closed && !req.signal.aborted && Date.now() < deadline) {
            const body = buildPatientStatusBody(snapshot, new Date(), timeZone);
            const key = `${statusKey(body.status)}|${JSON.stringify(body.timeline)}`;
            if (key !== lastKey) {
              send("status", body);
              lastKey = key;
              lastBeat = Date.now();
            } else if (Date.now() - lastBeat > HEARTBEAT_MS) {
              write(": keep-alive\n\n");
              lastBeat = Date.now();
            }
            const tone = body.status.tone;
            await new Promise((resolve) => setTimeout(resolve, tone === "working" ? WORKING_MS : tone === "you" ? YOUR_TURN_MS : WAITING_MS));
            if (closed || req.signal.aborted) break;
            snapshot = await loadPatientSnapshot(id, cache);
            if (!snapshot.found) {
              send("gone", { caseId: id });
              break;
            }
          }
        } catch (e) {
          console.error("[patient-status stream] Unable to load case status", e instanceof Error ? e.message : e);
          // Not "error": that name collides with EventSource's own connection-error event.
          send("failure", { message: "Unable to load the case status" });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      },
      cancel() {
        closed = true;
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
