/** ~800 tokens at four characters/token. Character windows also bound unbroken text. */
export function chunk(text: string, size = 3200, overlap = 400): string[] {
  if (!Number.isInteger(size) || !Number.isInteger(overlap) || size < 1 || overlap < 0 || overlap >= size) throw new Error('Invalid chunk window');
  const input = text.trim();
  const chunks: string[] = [];
  for (let start = 0; start < input.length; start += size - overlap) {
    const part = input.slice(start, start + size).trim();
    if (part) chunks.push(part);
    if (start + size >= input.length) break;
  }
  return chunks;
}

export interface PageChunk { chunkIndex: number; page: number | null; section: string | null; content: string }
/**
 * Page-aware chunking for uploaded documents: chunks never span pages, so every chunk keeps a page/section reference
 * for citations. Same windows as chunk().
 */
export function chunkPages(pages: readonly { page: number | null; section: string | null; text: string }[], size = 3200, overlap = 400): PageChunk[] {
  const out: PageChunk[] = [];
  for (const p of pages) {
    for (const content of chunk(p.text, size, overlap)) out.push({ chunkIndex: out.length, page: p.page, section: p.section, content });
  }
  return out;
}
