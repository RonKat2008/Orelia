import { requireSpace } from "@/lib/accounts/scope";
import { z } from "zod";
import { fail } from "@/lib/accounts/http";
import { getBlob } from "@/lib/accounts/blob";
import { getAccountStore } from "@/lib/accounts/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ docId: string }> };
const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain"]);

/** GET -> streams the private file to its owner (never a blob URL). ?download=1 forces an attachment. */
export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireSpace(req);
  if (!guard.ok) return guard.response;
  const { docId } = await ctx.params;
  if (!z.uuid().safeParse(docId).success) return fail(404, "not_found");
  const row = await getAccountStore().getDocument(guard.scopeId, docId);
  if (!row) return fail(404, "not_found");
  try {
    const file = await getBlob().read(row.blobPathname);
    if (!file) return fail(404, "not_found");
    const download = new URL(req.url).searchParams.get("download") === "1" || !INLINE.has(row.contentType);
    const safeName = row.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
    return new Response(file.stream, {
      headers: {
        "Content-Type": row.contentType === "text/plain" ? "text/plain; charset=utf-8" : row.contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    return fail(502, "file_unavailable", undefined, err);
  }
}
