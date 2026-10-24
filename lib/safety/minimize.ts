import type { CaseRecord } from './types';
export function minimize(record: CaseRecord, sharedFields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(sharedFields.filter(key => Object.hasOwn(record, key)).map(key => [key, structuredClone(record[key])]));
}
const canonical = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function values(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === 'object') return Object.values(value).flatMap(values);
  return [];
}
/** Conservative literal-value scan, not a semantic or paraphrase detector. */
export function containsUnsharedField(body: string, record: CaseRecord, sharedFields: readonly string[]): boolean {
  const text = canonical(body);
  // Keep spans rather than deleting text: only matches wholly contained in an
  // explicitly shared value are exempt, without joining previously separate words.
  const sharedSpans: { start: number; end: number }[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!sharedFields.includes(key)) continue;
    for (const raw of values(value)) {
      const needle = canonical(raw);
      let start = text.indexOf(needle);
      while (start !== -1) {
        sharedSpans.push({ start, end: start + needle.length });
        start = text.indexOf(needle, start + 1);
      }
    }
  }
  return Object.entries(record).some(([key, value]) => !sharedFields.includes(key) && values(value).some(raw => {
    const needle = canonical(raw);
    let offset = text.indexOf(needle);
    while (offset !== -1) {
      const before = text[offset - 1];
      const after = text[offset + needle.length];
      const withinSharedValue = sharedSpans.some(span => span.start <= offset && offset + needle.length <= span.end);
      if (!withinSharedValue && (!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))) return true;
      offset = text.indexOf(needle, offset + 1);
    }
    return false;
  }));
}
