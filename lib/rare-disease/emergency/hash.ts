/** Server-only content hash of the printable card (what the patient approves). */
import { createHash } from 'node:crypto';
import type { CardContent } from './contract';

/** JSON with sorted object keys, so the hash does not depend on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(content: CardContent): string {
  return createHash('sha256').update(canonical(content)).digest('hex');
}
