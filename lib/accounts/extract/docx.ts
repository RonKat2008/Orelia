/** Minimal, dependency-free DOCX text reader (ZIP via node:zlib). Output is untrusted text; callers sanitize it. */
import { inflateRawSync } from 'node:zlib';
import { ExtractionError, type ExtractedPage } from '../contract';

export const MAX_DOCX_XML_BYTES = 20 * 1024 * 1024;
const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const DOCUMENT_XML = 'word/document.xml';

const bad = () => new ExtractionError('invalid_file', 'That Word document could not be read. Try saving it again as a DOCX or PDF.');

/** Returns the (decompressed) bytes of one ZIP entry, or null when the archive has no such entry. */
export function readZipEntry(bytes: Uint8Array, name: string, maxBytes = MAX_DOCX_XML_BYTES): Buffer | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (rawSize > maxBytes) throw new ExtractionError('too_large', 'That Word document is too large to read.');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOC_SIG) throw bad();
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (start + compSize > buf.length) throw bad();
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return Buffer.from(data);
    if (method !== 8) throw bad();
    try {
      return inflateRawSync(data, { maxOutputLength: maxBytes });
    } catch {
      throw new ExtractionError('too_large', 'That Word document could not be read safely.');
    }
  }
  return null;
}

export function isDocx(bytes: Uint8Array): boolean {
  try { return readZipEntry(bytes, DOCUMENT_XML) !== null; } catch { return false; }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function paragraphText(xml: string): string {
  return decodeEntities(
    xml.replace(/<w:tab\b[^>]*\/>/g, '\t').replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''),
  );
}

/** Converts word/document.xml to text. A Heading paragraph starts a new page whose `section` is the heading. */
export function docxXmlToPages(xml: string): ExtractedPage[] {
  const pages: ExtractedPage[] = [];
  let section: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) pages.push({ page: null, section, text });
    lines = [];
  };
  for (const m of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const para = m[1];
    const text = paragraphText(para);
    const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(para)?.[1] ?? '';
    if (/^heading\s*\d?$/i.test(style) && text.trim()) {
      flush();
      section = text.trim().slice(0, 120);
    }
    lines.push(text);
  }
  flush();
  return pages;
}

export function extractDocxPages(bytes: Uint8Array): ExtractedPage[] {
  const xml = readZipEntry(bytes, DOCUMENT_XML);
  if (!xml) throw bad();
  return docxXmlToPages(xml.toString('utf8'));
}
