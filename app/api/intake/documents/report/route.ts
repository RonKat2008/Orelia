import { z } from "zod";
import { fail, json, readJson } from "@/lib/accounts/http";
import { reportForScope } from "@/lib/accounts/report-text";
import { requireSpace } from "@/lib/accounts/scope";
import { REPORT_TEXT_MIN } from "@/lib/contracts";

export const runtime = "nodejs";

const bodySchema = z.object({ ids: z.array(z.uuid()).max(50).optional() }).strict();

/** POST ?draft=1 { ids? } -> { reportText, titles } built server-side from the patient's own embedded documents. */
export async function POST(req: Request) {
  const guard = await requireSpace(req);
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const parsed = bodySchema.safeParse(body.value);
  if (!parsed.success) return fail(422, "invalid", "Choose documents from your list");
  try {
    const report = await reportForScope(guard.scopeId, parsed.data.ids);
    if (report.reportText.length < REPORT_TEXT_MIN) {
      return fail(422, "no_readable_text", "We could not find enough readable text in those documents. You can answer the questions instead.");
    }
    return json(report);
  } catch (err) {
    return fail(500, "report_failed", undefined, err);
  }
}
