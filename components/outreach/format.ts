/** Fixed zone so server and client render the same text. */
export function formatWhen(iso: string | null | undefined, fallback = "Not scheduled"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(date);
}

export function formatDay(iso: string | null | undefined, fallback = "No date"): string {
  if (!iso) return fallback;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(date);
}

export function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Capitalise each word of an all-lowercase name; names that already carry casing are left exactly as given. */
export function properName(text: string): string {
  if (text !== text.toLowerCase()) return text;
  return text.replace(/(^|[\s\-'(])(\p{L})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}
