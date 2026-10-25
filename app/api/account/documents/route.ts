import { requireSpace, withSpaceCookie } from "@/lib/accounts/scope";
import { fail, json, readJson } from "@/lib/accounts/http";
import { createLibraryDocument, listLibrary } from "@/lib/accounts/documents";
import { validateUpload } from "@/lib/accounts/upload";

export const runtime = "nodejs";

/** GET /api/account/documents?q= -> { documents } (newest first). */
export async function GET(req: Request) {
  const guard = await requireSpace(req);
  if (!guard.ok) return guard.response;
  try {
    const q = new URL(req.url).searchParams.get("q") ?? undefined;
    return withSpaceCookie(json({ documents: await listLibrary(guard.scopeId, q?.slice(0, 200)) }), guard);
  } catch (err) {
    return fail(500, "documents_unavailable", undefined, err);
  }
}

/** POST /api/account/documents CreateDocumentBody -> 201 { document, upload: { pathname } }; 413/415/422. */
export async function POST(req: Request) {
  const guard = await requireSpace(req);
  if (!guard.ok) return guard.response;
  const body = await readJson(req);
  if (!body.ok) return body.response;
  const valid = validateUpload(body.value);
  if (!valid.ok) return fail(valid.status, valid.error, valid.message);
  try {
    const created = await createLibraryDocument(guard.scopeId, valid.body);
    return json({ document: created.document, upload: { pathname: created.pathname } }, 201);
  } catch (err) {
    return fail(500, "create_failed", undefined, err);
  }
}
