import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webApplications } from "@/db/schema";
import { guardCase } from "@/lib/auth/ownership";
import { jsonError, parseId } from "../../../../_lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; appId: string }> };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** GET .../activity/screenshot/[appId] -> the filled-form screenshot as image/png (kept out of the activity snapshot). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const { id: rawId, appId: rawApp } = await params;
    const id = parseId(rawId);
    if (!id) return jsonError(400, "Invalid case id");
    const denied = await guardCase(req, id);
    if (denied) return denied;
    const appId = parseId(rawApp);
    if (!appId) return jsonError(404, "Screenshot not found");
    if (!process.env.DATABASE_URL) return jsonError(404, "Screenshot not found");
    const [row] = await getDb().select({ screenshot: webApplications.screenshot }).from(webApplications)
      .where(and(eq(webApplications.id, appId), eq(webApplications.caseId, id))).limit(1);
    const b64 = row?.screenshot?.replace(/^data:image\/png;base64,/, "");
    if (!b64 || !BASE64.test(b64)) return jsonError(404, "Screenshot not found");
    const bytes = Buffer.from(b64, "base64");
    if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) return jsonError(404, "Screenshot not found");
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return jsonError(500, "Unable to load screenshot", error);
  }
}
