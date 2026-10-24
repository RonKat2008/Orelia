/** PDF text extraction (unpdf / pdf.js, no OCR): one ExtractedPage per non-empty page. */
import { extractText, getDocumentProxy } from 'unpdf';
import { ExtractionError, type ExtractedPage } from '../contract';

export const MAX_PDF_PAGES = 300;

export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  let texts: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError('too_many_pages', `That PDF has more than ${MAX_PDF_PAGES} pages. Split it into smaller files and upload them separately.`);
    }
    texts = (await extractText(pdf, { mergePages: false })).text;
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new ExtractionError('encrypted', 'That PDF is password-protected, so it cannot be read. Remove the password and upload it again.');
    }
    throw new ExtractionError('invalid_file', 'That PDF could not be read. It may be damaged; try saving or printing it to a new PDF.');
  }
  const pages = texts
    .map((text, i) => ({ page: i + 1, section: null, text: text.replace(/[ \t]+/g, ' ').trim() }))
    .filter(p => p.text.length > 0);
  if (pages.length === 0) {
    throw new ExtractionError('no_text', 'This PDF looks like a scan with no text layer. Upload photos of the pages (PNG/JPG) and Wayfinder will read them.');
  }
  return pages;
}
