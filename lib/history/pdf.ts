/**
 * Server-side PDF text extraction for medical records (unpdf / pdf.js, no OCR). Text only: scanned or encrypted
 * PDFs are rejected with a friendly "paste the text instead" message. Nothing is stored here.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { MAX_RECORD_CHARS } from './contract';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

const PASTE_HINT = 'Please open the PDF, copy its text, and paste it into the box instead.';

export type PdfFailure = 'too_large' | 'too_many_pages' | 'encrypted' | 'no_text' | 'too_long' | 'invalid';

export class PdfError extends Error {
  constructor(readonly reason: PdfFailure, message: string) {
    super(message);
    this.name = 'PdfError';
  }
}

const isPdfHeader = (b: Uint8Array) => b.length > 5 && String.fromCharCode(...b.subarray(0, 5)) === '%PDF-';

/** Extracts the text of a PDF, or throws PdfError with a patient-facing message. */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  if (data.byteLength > MAX_PDF_BYTES) throw new PdfError('too_large', `That PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB. ${PASTE_HINT}`);
  if (!isPdfHeader(data)) throw new PdfError('invalid', `That file does not look like a PDF. ${PASTE_HINT}`);
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfError('too_many_pages', `That PDF has more than ${MAX_PDF_PAGES} pages. ${PASTE_HINT}`);
    text = (await extractText(pdf, { mergePages: true })).text;
  } catch (err) {
    if (err instanceof PdfError) throw err;
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') throw new PdfError('encrypted', `That PDF is password-protected, so it cannot be read. ${PASTE_HINT}`);
    throw new PdfError('invalid', `That PDF could not be read. ${PASTE_HINT}`);
  }
  const cleaned = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length < 20) throw new PdfError('no_text', `That PDF has no text in it (it may be a scan). ${PASTE_HINT}`);
  if (cleaned.length > MAX_RECORD_CHARS) throw new PdfError('too_long', `That PDF has more than ${MAX_RECORD_CHARS.toLocaleString('en-US')} characters of text. Split it into parts or paste the relevant pages.`);
  return cleaned;
}
