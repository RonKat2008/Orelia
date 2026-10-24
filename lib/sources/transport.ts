import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

export interface SourceRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Explicit recorded request key; never inferred from a disease name. */
  key?: string;
}
export interface SourceResponse { body: string; fetchedAt: string; status: number; requestUrl?: string }
export interface Transport { request(request: SourceRequest): Promise<SourceResponse> }
export class SourceError extends Error {
  constructor(public source: string, message: string, public status?: number) {
    super(`${source}: ${message}`); this.name = "SourceError";
  }
}
export class FetchTransport implements Transport {
  constructor(private fetcher: typeof fetch = fetch, private now = () => new Date()) {}
  async request(request: SourceRequest): Promise<SourceResponse> {
    const response = await this.fetcher(request.url, {
      method: request.method ?? "GET", headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new SourceError("http", "Request failed", response.status);
    return { body: await response.text(), fetchedAt: this.now().toISOString(), status: response.status };
  }
}
type ManifestEntry = {file: string; url: string; method?: string; fetched_at: string; status: number};
export class FixtureTransport implements Transport {
  constructor(private root = resolve(process.cwd(), "fixtures/api"), private keys: Record<string, string> = {}) {}
  async request(request: SourceRequest): Promise<SourceResponse> {
    const manifest = JSON.parse(await readFile(resolve(this.root, "MANIFEST.json"), "utf8")) as ManifestEntry[];
    const matches = manifest.filter(e => e.url === request.url);
    if (!request.key && (request.method === "POST" || matches.length > 1)) throw new SourceError("fixture", "Ambiguous recorded request; provide an explicit fixture key");
    const file = request.key ? (this.keys[request.key] ?? request.key) : matches[0]?.file;
    if (!file) throw new SourceError("fixture", "No recorded request matches; provide an explicit fixture key");
    const path = resolve(this.root, file);
    if (!path.startsWith(resolve(this.root) + sep)) throw new SourceError("fixture", "Invalid fixture path");
    const entry = manifest.find(e => e.file === file);
    if (!entry) throw new SourceError("fixture", "Missing manifest provenance");
    const recorded = new URL(entry.url), requested = new URL(request.url);
    if (recorded.origin !== requested.origin || recorded.pathname !== requested.pathname || (request.method ?? "GET") !== (entry.method ?? "GET")) throw new SourceError("fixture", "Fixture belongs to a different endpoint or method");
    if (entry.status >= 400) throw new SourceError("fixture", "Recorded request failed", entry.status);
    return { body: await readFile(path, "utf8"), fetchedAt: entry.fetched_at, status: entry.status, requestUrl: entry.url };
  }
}
/** Serial queue also spaces concurrent calls; a failed operation never poisons it. */
export class RateLimiter {
  private tail: Promise<unknown> = Promise.resolve();
  private next = 0;
  constructor(private perSecond: number, private clock = () => Date.now(), private sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    if (!Number.isFinite(perSecond) || perSecond <= 0) throw new Error("Invalid request rate");
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const delay = Math.max(0, this.next - this.clock());
      if (delay) await this.sleep(delay);
      this.next = this.clock() + Math.ceil(1000 / this.perSecond);
      return operation();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
export function json<T>(response: SourceResponse, source: string): T {
  if (response.status >= 400) throw new SourceError(source, "Request failed", response.status);
  try { return JSON.parse(response.body) as T; }
  catch { throw new SourceError(source, "Invalid JSON response"); }
}
