import { NextResponse } from "next/server";
import { guardCase } from "@/lib/auth/ownership";
import { contactsResponseSchema, getCaseActivity } from "@/lib/cases/activity";
import { displayAddressFor } from "@/lib/outreach/real-phone";
import { jsonError, parseId } from "../../_lib/http";
import { getServices } from "../../_lib/services";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/contacts — outreach contacts for the case shell, tracker, and outbox. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const id = parseId((await params).id);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const activity = getCaseActivity();
    // One parallel round; a missing case still answers 404 (the reads are discarded).
    const [found, contacts, tasks] = await Promise.all([getServices().cases.get(id), activity.contacts(id), activity.tasks(id)]);
    if (!found) return jsonError(404, "Case not found");
    const openTaskCount = tasks.filter((task) => task.status === "open").length;
    const shown = await Promise.all(contacts.map(async (c) => ({ ...c, ...(await displayAddressFor(process.env, { ...c, caseId: id })) })));
    const body = contactsResponseSchema.parse({ caseId: id, contacts: shown, openTaskCount });
    return NextResponse.json(body);
  } catch (error) {
    return jsonError(500, "Unable to load contacts", error);
  }
}
