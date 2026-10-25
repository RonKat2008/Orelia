import { requireSpace } from "@/lib/accounts/scope";
import { z } from "zod";
import { fail, json } from "@/lib/accounts/http";
import { markUploaded, processLibraryDocument } from "@/lib/accounts/documents";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ docId: string }> };

/** POST -> extract + chunk + embed inline (also the Retry action). Returns the document with its new status. */
export async function POST(req: Request, ctx: Ctx) {
  const guard = await requireSpace(req);
  if (!guard.ok) return guard.response;
  const { docId } = await ctx.params;
  if (!z.uuid().safeParse(docId).success) return fail(404, "not_found");
  try {
    await markUploaded(guard.scopeId, docId);
    const doc = await processLibraryDocument(guard.scopeId, docId);
    return doc ? json({ document: doc }) : fail(404, "not_found");
  } catch (err) {
    return fail(500, "process_failed", "We could not read this document. Please retry.", err);
  }
}
