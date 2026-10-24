/**
 * Private file storage port. Production: a private Vercel Blob store (never public URLs; downloads go through an
 * authenticated route). Tests/offline: in-memory.
 */
export interface StoredFile { stream: ReadableStream<Uint8Array>; contentType: string; size: number }
export interface BlobPort {
  read(pathname: string): Promise<StoredFile | null>;
  remove(pathnames: string[]): Promise<void>;
}

export async function readAll(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new Error('File exceeds the size limit'); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
  return out;
}

export const vercelBlob: BlobPort = {
  async read(pathname) {
    const { get } = await import('@vercel/blob');
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, contentType: result.blob.contentType, size: result.blob.size };
  },
  async remove(pathnames) {
    if (!pathnames.length) return;
    const { del } = await import('@vercel/blob');
    await del(pathnames);
  },
};

export class MemoryBlob implements BlobPort {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  put(pathname: string, bytes: Uint8Array, contentType: string) { this.files.set(pathname, { bytes, contentType }); }
  async read(pathname: string) {
    const f = this.files.get(pathname);
    if (!f) return null;
    const bytes = f.bytes;
    return { stream: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }), contentType: f.contentType, size: bytes.byteLength };
  }
  async remove(pathnames: string[]) { for (const p of pathnames) this.files.delete(p); }
}

const g = globalThis as { __wayfinderBlob?: BlobPort };
export function blobConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.BLOB_READ_WRITE_TOKEN || (env.BLOB_STORE_ID && env.VERCEL_OIDC_TOKEN));
}
export function getBlob(): BlobPort {
  g.__wayfinderBlob ??= blobConfigured() ? vercelBlob : new MemoryBlob();
  return g.__wayfinderBlob;
}
export function setBlobForTests(blob: BlobPort | undefined): void {
  if (blob) g.__wayfinderBlob = blob;
  else delete g.__wayfinderBlob;
}
