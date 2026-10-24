import { randomUUID } from 'node:crypto';
import { ACCEPTED_TYPES, MAX_FILE_BYTES, createDocumentSchema, type CreateDocumentBody } from './contract';

export type UploadValidation =
  | { ok: true; body: CreateDocumentBody; contentType: string }
  | { ok: false; status: 413 | 415 | 422; error: string; message: string };

const extOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';

/** Server-side upload validation (the client checks too, but never trust it): schema, 25 MB cap, type + extension. */
export function validateUpload(input: unknown): UploadValidation {
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 422, error: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid document' };
  const body = parsed.data;
  if (body.sizeBytes > MAX_FILE_BYTES) return { ok: false, status: 413, error: 'too_large', message: 'Files can be up to 25 MB each.' };
  const ext = extOf(body.fileName);
  let contentType = body.contentType.toLowerCase().split(';')[0].trim();
  // Browsers often send an empty or generic type for HEIC/DOCX: fall back to the extension.
  if (!ACCEPTED_TYPES[contentType]) {
    const byExt = Object.entries(ACCEPTED_TYPES).find(([, exts]) => exts.includes(ext));
    if (byExt && (contentType === '' || contentType === 'application/octet-stream')) contentType = byExt[0];
  }
  const exts = ACCEPTED_TYPES[contentType];
  if (!exts || !exts.includes(ext)) {
    return { ok: false, status: 415, error: 'unsupported_type', message: 'Upload a PDF, PNG, JPG, HEIC, TXT or DOCX file.' };
  }
  return { ok: true, body: { ...body, contentType }, contentType };
}

/** Blob pathname: per-account prefix + unguessable id; the original file name never reaches the path. */
export function blobPathnameFor(accountId: string, documentId: string, fileName: string): string {
  const ext = extOf(fileName).replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `accounts/${encodeURIComponent(accountId)}/${documentId}/${randomUUID()}.${ext}`;
}

export function pathnameBelongsTo(pathname: string, accountId: string): boolean {
  return pathname.startsWith(`accounts/${encodeURIComponent(accountId)}/`) && !pathname.includes('..');
}
