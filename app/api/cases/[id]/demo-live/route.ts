import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCrossOrigin } from "@/lib/auth/origin";
import { guardCase } from "@/lib/auth/ownership";
import { liveDemoEnabled } from "@/lib/demo-live/start";
import { isLiveDemoCase, skipAhead } from "@/lib/demo-live/skip-ahead";
import { emailDestinationAvailability } from "@/lib/outreach/demo-email-destination";
import { runCronTick } from "@/lib/workflows/cron-tick";
import { jsonError, parseBody, parseId } from "../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["tick", "skip_ahead"]) }).strict(),
  z.object({ action: z.literal("email_destination"), value: z.enum(["scripted", "personal"]) }).strict(),
]);

/**
 * POST /api/cases/[id]/demo-live { action } -> DEMO MODE ONLY, live-demo cases only (owner-guarded).
 *   tick:       run the per-minute cron tick now (follow-up sweep, demo coordinator replies, due agents), so the
 *               presenter does not wait for the next minute. Same code, same leases, same gate as the cron.
 *   skip_ahead: simulated time: this case's waiting contacts move 5 days back, then the tick runs.
 *   email_destination: { value: 'scripted' | 'personal' } where this case's TEST emails go. Only a configured coordinator
 *               inbox of that group can ever be used (never an address from the client); the outbound gate is unchanged.
 * None of them approves or sends anything by itself.
 */
export async function POST(req: Request, { params }: Ctx) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;
  if (!liveDemoEnabled(process.env)) return jsonError(404, "Not found");
  const id = parseId((await params).id);
  if (!id) return jsonError(400, "Invalid case id");
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.response;
  try {
    if (!(await isLiveDemoCase(id))) return jsonError(404, "Not a live demo case");
    if (parsed.data.action === "email_destination") {
      const choice = parsed.data.value;
      if (!emailDestinationAvailability(process.env)[choice]) return jsonError(409, "That inbox is not configured for this deployment");
      const { setEmailDestinationChoice, rerouteDraftedEmailContacts } = await import("@/lib/demo-live/email-destination");
      await setEmailDestinationChoice(id, choice);
      const rerouted = await rerouteDraftedEmailContacts(id, process.env, choice);
      return NextResponse.json({ ok: true, choice, rerouted }, { headers: { "Cache-Control": "no-store" } });
    }
    const shifted = parsed.data.action === "skip_ahead" ? await skipAhead(id) : null;
    const tick = await runCronTick();
    return NextResponse.json({ ok: tick.ok, shifted, steps: tick.steps }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(500, "Unable to run the demo step", error);
  }
}
