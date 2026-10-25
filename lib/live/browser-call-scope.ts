/**
 * DEMO browser call: the pages whose document carries the browser-call CSP and microphone=(self) (vercel.ts).
 * Next.js navigates client-side, so a page keeps the headers of the document it was first loaded as. The demo opens
 * the live console from /demo and the case stages link to it, so both get the policy; any other entry point reloads
 * the live console before the call starts (components/live/browser-call-store.ts).
 */
export const BROWSER_CALL_SOURCES = ["/demo", "/cases/:path*"] as const;
/** Every other path (Vercel path-to-regexp with a negative lookahead). */
export const DEFAULT_HEADERS_SOURCE = "/((?!demo$|cases/).*)";

/** True when a document first loaded at this path got the browser-call headers. */
export function documentAllowsBrowserCall(pathname: string): boolean {
  return pathname === "/demo" || pathname.startsWith("/cases/");
}
