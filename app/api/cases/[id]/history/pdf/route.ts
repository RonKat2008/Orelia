import { NextResponse } from 'next/server';
import { guardCase } from '@/lib/auth/ownership';
import { gatewayConfig } from '@/lib/ai/gateway';
import { MAX_TITLE_CHARS } from '@/lib/history/contract';
import { addRecord, HistoryLimitError } from '@/lib/history/ingest';
import { extractPdfText, MAX_PDF_BYTES, PdfError } from '@/lib/history/pdf';
import { jsonError, parseId } from '../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/cases/[id]/history/pdf (multipart: file, title?) -> 201 like POST /history. Text-bearing PDFs only. */
export async function POST(req: Request, { params }: Ctx) {
  const id = parseId((await params).id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  // Reject oversized bodies before buffering them.
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_PDF_BYTES + 64 * 1024) return jsonError(413, 'That PDF is too large. Paste its text instead.');
  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError(400, 'Body must be multipart form data'); }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'Attach a PDF file', undefined, ['file']);
  if (file.size > MAX_PDF_BYTES) return jsonError(413, 'That PDF is too large. Paste its text instead.');
  const rawTitle = form.get('title');
  const title = (typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle : file.name.replace(/\.pdf$/i, '')).trim().slice(0, MAX_TITLE_CHARS) || 'PDF record';
  try {
    const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    const result = await addRecord(id, { title, text }, { llm: gatewayConfig() !== undefined });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PdfError) return jsonError(err.reason === 'too_large' ? 413 : 422, err.message);
    if (err instanceof HistoryLimitError) return jsonError(422, err.message);
    return jsonError(500, 'Unable to add the PDF', err);
  }
}
