import { modelFor } from '@/config/models';
import { gatewayConfig } from './gateway';

export const DIMENSIONS = 1024;
export const FAKE_EMBED_MODEL = 'wayfinder-hashed-bow-v1';
export function embeddingModel() {
  return process.env.WAYFINDER_OFFLINE === '1' || !gatewayConfig() ? FAKE_EMBED_MODEL : modelFor('embedding');
}
function normalize(vector: number[]) {
  const norm = Math.hypot(...vector);
  return norm ? vector.map(n => n / norm) : vector;
}
/** Stable token hashing; independent of input ordering and process state. */
export function fakeEmbed(text: string): number[] {
  const vector = Array<number>(DIMENSIONS).fill(0);
  for (const token of text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    vector[hash % DIMENSIONS] += 1;
  }
  if (!vector.some(Boolean)) vector[0] = 1;
  return normalize(vector);
}
export async function embed(texts: string[]): Promise<number[][]> {
  const gateway = gatewayConfig();
  if (embeddingModel() === FAKE_EMBED_MODEL || !gateway) return texts.map(fakeEmbed);
  const output: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += 150) {
    const batch = texts.slice(offset, offset + 150);
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${gateway.base}/v1/embeddings`, {
        method: 'POST', headers: { Authorization: `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelFor('embedding'), input: batch, dimensions: DIMENSIONS }),
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status === 429 && attempt < 3) {
        const retry = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Math.min(30_000, retry > 0 ? retry * 1000 : 250 * 2 ** attempt)));
        continue;
      }
      if (!response.ok) throw new Error(`Embedding request failed (${response.status})`);
      const data = await response.json() as { data?: { index: number; embedding: number[] }[] };
      const sorted = data.data?.slice().sort((a, b) => a.index - b.index);
      if (!sorted || sorted.length !== batch.length || sorted.some((row, i) => row.index !== i || !Array.isArray(row.embedding) || row.embedding.length !== DIMENSIONS || row.embedding.some(n => !Number.isFinite(n)) || !row.embedding.some(n => n !== 0))) {
        throw new Error('Invalid embedding response');
      }
      output.push(...sorted.map(row => normalize(row.embedding)));
      break;
    }
  }
  return output;
}
