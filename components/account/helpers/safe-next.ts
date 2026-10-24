export const DEFAULT_AFTER_AUTH = "/account";

/**
 * Only same-site relative paths may be used as a post-sign-in destination.
 * Rejects absolute URLs, protocol-relative ("//host"), backslash tricks and control characters.
 */
export function safeNext(raw: string | null | undefined, fallback: string = DEFAULT_AFTER_AUTH): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/** Sign-in link that returns the person to `path` afterwards. */
export function signInHref(path: string): string {
  return `/auth/sign-in?next=${encodeURIComponent(safeNext(path, "/"))}`;
}
