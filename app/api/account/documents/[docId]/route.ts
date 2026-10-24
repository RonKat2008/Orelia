import { z } from "zod";
import { updateDocumentSchema } from "@/lib/accounts/contract";
import { fail, json, readJson, requireAccount } from "@/lib/accounts/http";
import { deleteLibraryDocument, updateLibraryDocument } from "@/lib/accounts/documents";
import { removeFromCases } from "@/lib/accounts/case-link";
import { getAccountStore, toLibraryDocument } from "@/lib/accounts/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ docId: string }> };
const idOf = async (ctx: Ctx) => (z.uuid().safeParse((await ctx.params).docId).success ? (await ctx.params).docId : null);
const notFound = () => fail(404, "not_found");

export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const id = await idOf(ctx);
  if (!id) return notFound();
  const row = await getAccountStore().getDocument(guard.account.id, id);
  return row ? json({ document: toLibraryDocument(row) }) : notFound();
}

export async function PATCH(req: Request, ctx: Ctx) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const id = await idOf(ctx);
  if (!id) return notFound();
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const parsed = updateDocumentSchema.safeParse(body.value);
  if (!parsed.success) return fail(422, "invalid", parsed.error.issues[0]?.message ?? "Invalid metadata");
  const p = parsed.data;
  const doc = await updateLibraryDocument(guard.account.id, id, {
    ...(p.title !== undefined && { title: p.title }), ...(p.docType !== undefined && { docType: p.docType }),
    ...(p.dateOfService !== undefined && { dateOfService: p.dateOfService ?? null }),
    ...(p.provider !== undefined && { provider: p.provider ?? null }), ...(p.notes !== undefined && { notes: p.notes ?? null }),
    ...(p.tags !== undefined && { tags: p.tags }),
  });
  return doc ? json({ document: doc }) : notFound();
}

/** DELETE removes the file, its chunks/embeddings, the row, and its copies in this account's case histories. */
export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireAccount(req);
  if (!guard.ok) return guard.response;
  const id = await idOf(ctx);
  if (!id) return notFound();
  try {
    const row = await getAccountStore().getDocument(guard.account.id, id);
    if (!row || !(await deleteLibraryDocument(guard.account.id, id))) return notFound();
    try { await removeFromCases(guard.account.id, row); } catch (err) { console.error("[accounts] case copy cleanup failed", err instanceof Error ? err.name : "error"); }
    return new Response(null, { status: 204 });
  } catch (err) {
    return fail(500, "delete_failed", "We could not delete this document. Please try again.", err);
  }
}
