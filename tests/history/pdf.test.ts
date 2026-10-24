import { describe, expect, it } from 'vitest';
import { extractPdfText, MAX_PDF_BYTES, MAX_PDF_PAGES, PdfError } from '@/lib/history/pdf';
import { makePdf } from './pdf-fixture';

const reasonOf = async (data: Uint8Array) => {
  try { await extractPdfText(data); } catch (err) { return err instanceof PdfError ? err.reason : `other:${String(err)}`; }
  return 'ok';
};

describe('extractPdfText', () => {
  it('extracts text from a text-bearing PDF across pages', async () => {
    const text = await extractPdfText(makePdf([['Genetics clinic visit 2024-03-12.', 'COL3A1 variant reported.'], ['Second page plan: refer to cardiology.']]));
    expect(text).toContain('Genetics clinic visit 2024-03-12.');
    expect(text).toContain('COL3A1 variant reported.');
    expect(text).toContain('refer to cardiology');
  });

  it('rejects a PDF without a text layer (scanned) with a paste hint', async () => {
    const data = makePdf([[], []]);
    expect(await reasonOf(data)).toBe('no_text');
    await expect(extractPdfText(data)).rejects.toThrow(/paste/i);
  });

  it('rejects an encrypted PDF', async () => {
    expect(await reasonOf(makePdf([['Some hidden record text here for the test.']], { encrypt: true }))).toBe('encrypted');
  });

  it('rejects non-PDF bytes and corrupt PDFs', async () => {
    expect(await reasonOf(new TextEncoder().encode('just some text, definitely not a pdf'))).toBe('invalid');
    expect(await reasonOf(new TextEncoder().encode('%PDF-1.4\ngarbage that is not a document'))).toBe('invalid');
  });

  it('enforces the size and page limits', async () => {
    expect(await reasonOf(new Uint8Array(MAX_PDF_BYTES + 1))).toBe('too_large');
    const many = makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => ['A line of synthetic record text.']));
    expect(await reasonOf(many)).toBe('too_many_pages');
  });
});
