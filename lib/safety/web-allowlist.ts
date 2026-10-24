/** Host allowlist for web form submissions (OUTBOUND_WEB_ALLOWLIST). Entries are `hostname` or `hostname:port`. */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_ENTRY = new RegExp(`^(${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}))?$`);
const LOOPBACK = new Set(['localhost', '127.0.0.1']);

function normalizeWebHost(entry: string): string | null {
  const value = entry.trim().toLowerCase();
  const match = HOST_ENTRY.exec(value);
  if (!match) return null;
  if (match[2] !== undefined) {
    const port = Number(match[2]);
    if (port < 1 || port > 65535) return null;
  }
  return value;
}

/** Comma separated hosts; lowercased, trimmed, deduplicated. Wildcards, schemes and paths are dropped. */
export function parseWebAllowlist(env: string): string[] {
  return [...new Set(env.split(',').map(normalizeWebHost).filter((v): v is string => v !== null))];
}

/** https only (http solely for localhost/127.0.0.1), no userinfo, exact host[:port] or port-less hostname match. */
export function isWebAllowed(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { return false; }
  const hostname = parsed.hostname.toLowerCase();
  const host = parsed.host.toLowerCase();
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK.has(hostname))) return false;
  return hosts.some(raw => {
    const entry = normalizeWebHost(raw);
    if (!entry) return false;
    return entry.includes(':') ? entry === host : entry === hostname;
  });
}
