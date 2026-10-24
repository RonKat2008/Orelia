/**
 * One rendering of a case field as form text, shared by the form mapper (what gets typed) and the web gate
 * (what it checks against the case record), so a ticked list field such as goals is "a, b" on both sides.
 */
export function formatFieldValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map(v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : ''))
      .filter(Boolean);
    return parts.length ? parts.join(', ') : undefined;
  }
  return undefined;
}

/** Case-, width- and whitespace-insensitive; list separators are normalised to ", " before comparing. */
const canonical = (text: string) => text.normalize('NFKC').replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim().toLowerCase();

/** True when a filled form value is the rendering of the case field (select options may differ only in case). */
export function sameFieldValue(filled: unknown, caseValue: unknown): boolean {
  const a = formatFieldValue(filled);
  const b = formatFieldValue(caseValue);
  return a !== undefined && b !== undefined && canonical(a) === canonical(b);
}
