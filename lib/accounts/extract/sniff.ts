/** Magic-byte checks: a declared content type must match what the bytes actually are. */
import { isDocx } from './docx';

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

const HEIC_BRANDS = new Set(['heic', 'heix', 'mif1', 'heif']);
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function isUtf8Text(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
}

export function matchesMagic(contentType: string, b: Uint8Array): boolean {
  switch (contentType) {
    case 'application/pdf': return ascii(b, 0, 5) === '%PDF-';
    case 'image/png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg': return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/heic':
    case 'image/heif': return b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(b, 8, 12));
    case 'text/plain': return isUtf8Text(b);
    case DOCX_TYPE: return startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && isDocx(b);
    default: return false;
  }
}
