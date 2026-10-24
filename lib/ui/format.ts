/** Pure helpers behind the UI primitives. Kept framework-free so they are unit-tested. */

export interface SourceInfo {
  /** Safe http(s) URL, or null when the input is not a navigable web address. */
  href: string | null;
  /** Hostname without a leading "www.", or the raw input when it cannot be parsed. */
  domain: string;
}

export function parseSource(url: string): SourceInfo {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { href: null, domain: parsed.hostname || url };
    }
    return { href: parsed.toString(), domain: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return { href: null, domain: url };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-04" | Date -> "Mar 4, 2026". Invalid input returns null so callers can omit it. */
export function formatSourceDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/** "Maria del Carmen Ortiz" -> "MO"; "prince" -> "P"; "" -> "?". */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Deterministic index in [0, buckets) for a string, so an avatar keeps its tone. */
export function hashToBucket(value: string, buckets: number): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return buckets > 0 ? hash % buckets : 0;
}

/** Clamp a progress value to [0, max] and return a 0..100 percentage. */
export function toPercent(value: number, max = 100): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}
