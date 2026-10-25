/**
 * Server-side text extraction for uploaded medical documents. Output is untrusted DATA: every page goes through
 * sanitizeRecordText. Never log extracted text (only error names, if anything).
 */
import { sanitizeRecordText } from '@/lib/history/sanitize';
import { hasClaudeCredentials } from '@/lib/ai/gateway';
import { ACCEPTED_TYPES, ExtractionError, MAX_FILE_BYTES, type ExtractedPage, type ExtractionOutput } from '../contract';
import { extractDocxPages } from './docx';
import { extractPdfPages } from './pdf';
import { matchesMagic } from './sniff';
import { defaultVision, MAX_VISION_IMAGE_BYTES, type VisionFn } from './vision';

export interface ExtractionInput { bytes: Uint8Array; contentType: string; fileName: string }
export interface ExtractionDeps { vision?: VisionFn; offline?: boolean }

const NO_TEXT = 'No readable text was found in that file.';
const HEIC_NOTE = 'HEIC photos are stored safely, but Wayfinder cannot read their text yet. Convert to JPG to have it read.';
const VISION_OFF_NOTE = 'Text reading for images needs the AI service, which is not configured here.';

const none = (note: string): ExtractionOutput => ({ pages: [], method: 'none', note });

function sanitizePages(pages: ExtractedPage[]): ExtractedPage[] {
  return pages
    .map(p => ({ ...p, text: sanitizeRecordText(p.text) }))
    .filter(p => p.text.length > 0);
}

function finish(method: ExtractionOutput['method'], pages: ExtractedPage[], emptyMessage = NO_TEXT): ExtractionOutput {
  const clean = sanitizePages(pages);
  if (clean.length === 0) throw new ExtractionError('no_text', emptyMessage);
  return { pages: clean, method };
}

async function extractImage(input: ExtractionInput, deps: ExtractionDeps): Promise<ExtractionOutput> {
  const vision = deps.vision ?? (!deps.offline && hasClaudeCredentials() ? defaultVision : undefined);
  if (deps.offline || !vision) return none(VISION_OFF_NOTE);
  if (input.bytes.byteLength > MAX_VISION_IMAGE_BYTES) {
    throw new ExtractionError('image_too_large', 'Images over 5 MB cannot be read yet; please upload a smaller photo or a PDF.');
  }
  let text: string;
  try {
    text = await vision({ base64: Buffer.from(input.bytes).toString('base64'), mediaType: input.contentType });
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    console.warn('accounts.extract.vision_failed', err instanceof Error ? err.name : 'Error');
    throw new ExtractionError('vision_failed', 'Wayfinder could not read the text in that image right now. Please try again later.');
  }
  return finish('vision', [{ page: null, section: null, text }], 'Wayfinder could not find any readable text in that image.');
}

export async function extractDocumentText(input: ExtractionInput, deps: ExtractionDeps = {}): Promise<ExtractionOutput> {
  const contentType = input.contentType.split(';')[0].trim().toLowerCase();
  if (input.bytes.byteLength === 0) throw new ExtractionError('empty_file', 'That file is empty.');
  if (input.bytes.byteLength > MAX_FILE_BYTES) {
    throw new ExtractionError('too_large', `That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it or upload a smaller version.`);
  }
  if (!(contentType in ACCEPTED_TYPES)) {
    throw new ExtractionError('unsupported_type', 'That file type is not supported. Upload a PDF, PNG, JPG, HEIC, TXT or DOCX file.');
  }
  if (!matchesMagic(contentType, input.bytes)) {
    throw new ExtractionError('type_mismatch', 'That file does not look like the type it was uploaded as. Check the file and try again.');
  }
  switch (contentType) {
    case 'application/pdf': return finish('pdf', await extractPdfPages(input.bytes));
    case 'image/png':
    case 'image/jpeg': return extractImage({ ...input, contentType }, deps);
    case 'image/heic':
    case 'image/heif': return none(HEIC_NOTE);
    case 'text/plain': {
      const text = new TextDecoder('utf-8').decode(input.bytes).replace(/^﻿/, '');
      return finish('text', [{ page: null, section: null, text }]);
    }
    default: return finish('docx', extractDocxPages(input.bytes));
  }
}
