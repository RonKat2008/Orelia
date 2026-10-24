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
const RETRY_LIMIT = 3;
const MAX_BACKOFF_MS = 30_000;

/** Origin and path only, so API keys and caller addresses in the query string never appear in errors. */
export function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "unknown-endpoint";
  }
}

/** Retry-After (seconds or HTTP-date), otherwise exponential backoff. Capped so a bad header cannot stall a run. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - now), MAX_BACKOFF_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function publicFailure(body: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    const message = typeof parsed.error === "string" ? parsed.error : "";
    // NCBI puts the caller IP in `api-key`. Never copy that field, an address, or a credential into the error.
    if (message && !/(\d{1,3}\.){3}\d{1,3}/.test(message) && !/key|token|secret/i.test(message)) detail = `: ${message.slice(0, 160)}`;
  } catch { /* non-JSON body */ }
  return detail;
}

/** One limiter per source and rate, shared by every client in the process. */
const sharedLimiters = new Map<string, RateLimiter>();
export function sharedLimiter(bucket: string, perSecond: number): RateLimiter {
  const key = `${bucket}:${perSecond}`;
  let limiter = sharedLimiters.get(key);
  if (!limiter) {
    limiter = new RateLimiter(perSecond);
    sharedLimiters.set(key, limiter);
  }
  return limiter;
}

function liveBucket(url: string): { bucket: string; perSecond: number } | undefined {
  let host = "";
  let keyed = false;
  try {
    const u = new URL(url);
    host = u.hostname;
    const apiKey = u.searchParams.get("api_key");
    keyed = !!apiKey && apiKey.length > 0;
  } catch {
    return undefined;
  }
  if (host.endsWith("ncbi.nlm.nih.gov")) return { bucket: keyed ? "pubmed-keyed" : "pubmed", perSecond: keyed ? 10 : 3 };
  if (host.endsWith("npiregistry.cms.hhs.gov")) return { bucket: "nppes", perSecond: 3 };
  if (host.endsWith("clinicaltrials.gov")) return { bucket: "ctgov", perSecond: 3 };
  return undefined;
}

export class FetchTransport implements Transport {
  constructor(
    private fetcher: typeof fetch = fetch,
    private now = () => new Date(),
    private sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}
  async request(request: SourceRequest): Promise<SourceResponse> {
    const endpoint = endpointOf(request.url);
    const bucket = liveBucket(request.url);
    for (let attempt = 0; ; attempt++) {
      const response = await this.send(request, bucket);
      if (response.status === 429 && attempt < RETRY_LIMIT) {
        await this.sleep(retryDelayMs(response.headers.get("retry-after"), attempt, this.now().getTime()));
        continue;
      }
      const body = await response.text();
      if (!response.ok) throw new SourceError("http", `HTTP ${response.status} ${endpoint}${publicFailure(body)}`, response.status);
      return { body, fetchedAt: this.now().toISOString(), status: response.status, requestUrl: request.url };
    }
  }
  private send(request: SourceRequest, bucket: { bucket: string; perSecond: number } | undefined): Promise<Response> {
    const exec = () => this.fetcher(request.url, {
      method: request.method ?? "GET", headers: request.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(30_000),
    });
    return bucket ? sharedLimiter(bucket.bucket, bucket.perSecond).run(exec) : exec();
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
  if (response.status >= 400) throw new SourceError(source, `HTTP ${response.status} ${response.requestUrl ? endpointOf(response.requestUrl) : "unknown-endpoint"}`, response.status);
  try { return JSON.parse(response.body) as T; }
  catch { throw new SourceError(source, "Invalid JSON response"); }
}
