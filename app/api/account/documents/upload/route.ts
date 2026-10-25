import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { MAX_FILE_BYTES } from "@/lib/accounts/contract";
import { fail, json } from "@/lib/accounts/http";
import { requireSpace } from "@/lib/accounts/scope";
import { markUploaded } from "@/lib/accounts/documents";
import { getAccountStore } from "@/lib/accounts/store";
import { pathnameBelongsTo } from "@/lib/accounts/upload";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Client direct upload to the PRIVATE blob store. Token requests need the signed-in owner of a pending document whose
 * reserved pathname matches exactly; the token is limited to that pathname, its content type and 25 MB.
 * The upload-completed callback comes from Vercel Blob (signature-verified by handleUpload), not from a browser.
 */
export async function POST(req: Request) {
  let body: HandleUploadBody | null = null;
  try {
    body = (await req.clone().json()) as HandleUploadBody;
  } catch {
    body = null;
  }
  let accountId: string | null = null;
  if (body?.type !== "blob.upload-completed") {
    const guard = await requireSpace(req);
    if (!guard.ok) return guard.response;
    accountId = guard.scopeId;
    if (body?.type !== "blob.generate-client-token") return fail(400, "invalid_request");
  }
  try {
    const result = await handleUpload({
      request: req,
      body: body!,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!accountId || !clientPayload || !UUID.test(clientPayload) || !pathnameBelongsTo(pathname, accountId)) {
          throw new Error("Upload not allowed");
        }
        const doc = await getAccountStore().getDocument(accountId, clientPayload);
        if (!doc || doc.blobPathname !== pathname || doc.status === "embedded" || doc.status === "extracting") {
          throw new Error("Upload not allowed");
        }
        return {
          allowedContentTypes: [doc.contentType],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ accountId, documentId: doc.id }),
        };
      },
      onUploadCompleted: async ({ tokenPayload }) => {
        const parsed = JSON.parse(tokenPayload ?? "{}") as { accountId?: string; documentId?: string };
        if (parsed.accountId && parsed.documentId) await markUploaded(parsed.accountId, parsed.documentId);
      },
    });
    return json(result);
  } catch (err) {
    return fail(400, "upload_not_allowed", "This upload could not be started. Refresh and try again.", err);
  }
}
