import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FetchTransport, FixtureTransport, RateLimiter, SourceError, endpointOf, json, retryDelayMs, sharedLimiter } from "../../lib/sources/transport";

const NOW = "2026-10-24T04:40:00.000Z";
const clock = () => new Date(NOW);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("endpointOf", () => {
  it("strips query strings so credentials never leak", () => {
    expect(endpointOf("https://example.test/a/b?api_key=zzz")).toBe("https://example.test/a/b");
  });
  it("returns a placeholder when the URL cannot be parsed", () => {
    expect(endpointOf("not a url")).toBe("unknown-endpoint");
  });
});

describe("retryDelayMs", () => {
  it("honours numeric Retry-After seconds", () => {
    expect(retryDelayMs("2", 0)).toBe(2000);
  });
  it("caps oversized Retry-After values at 30 seconds", () => {
    expect(retryDelayMs("9999", 0)).toBe(30_000);
  });
  it("converts an HTTP-date into a delay relative to now", () => {
    const now = Date.parse("2026-10-24T00:00:00Z");
    expect(retryDelayMs("Sat, 24 Oct 2026 00:00:05 GMT", 0, now)).toBe(5000);
  });
  it("clamps a past HTTP-date to zero", () => {
    const now = Date.parse("2026-10-24T00:01:00Z");
    expect(retryDelayMs("Sat, 24 Oct 2026 00:00:05 GMT", 0, now)).toBe(0);
  });
  it("caps a far-future HTTP-date", () => {
    const now = Date.parse("2026-10-24T00:00:00Z");
    expect(retryDelayMs("Mon, 24 Oct 2033 00:00:00 GMT", 0, now)).toBe(30_000);
  });
  it("falls back to exponential backoff for unparseable headers", () => {
    expect(retryDelayMs("garbage", 2)).toBe(4000);
  });
  it("uses exponential backoff, capped, when no header is present", () => {
    expect(retryDelayMs(null, 1)).toBe(2000);
    expect(retryDelayMs(null, 20)).toBe(30_000);
  });
});

describe("sharedLimiter", () => {
  it("returns the same limiter for the same bucket and rate", () => {
    expect(sharedLimiter("b-test", 5)).toBe(sharedLimiter("b-test", 5));
  });
  it("returns distinct limiters for different rates", () => {
    expect(sharedLimiter("b-test", 5)).not.toBe(sharedLimiter("b-test", 6));
  });
});

describe("RateLimiter construction", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid rate %s", rate => {
    expect(() => new RateLimiter(rate)).toThrow("Invalid request rate");
  });
});

describe("json helper", () => {
  it("reports status and endpoint for HTTP errors", () => {
    const run = () => json({ body: "", fetchedAt: NOW, status: 503, requestUrl: "https://h.test/p?k=secret" }, "src");
    expect(run).toThrow("src: HTTP 503 https://h.test/p");
    expect(run).not.toThrow(/secret/);
  });
  it("uses a placeholder endpoint when requestUrl is absent", () => {
    expect(() => json({ body: "", fetchedAt: NOW, status: 500 }, "src")).toThrow("unknown-endpoint");
  });
  it("throws a SourceError on malformed JSON", () => {
    expect(() => json({ body: "{nope", fetchedAt: NOW, status: 200 }, "src")).toThrow("Invalid JSON response");
  });
  it("parses valid JSON", () => {
    expect(json<{ a: number }>({ body: '{"a":1}', fetchedAt: NOW, status: 200 }, "src")).toEqual({ a: 1 });
  });
});

describe("FetchTransport", () => {
  it("defaults to GET with no body and records the request URL", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock);
    const res = await t.request({ url: "https://other.test/x" });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(res).toMatchObject({ body: "ok", status: 200, requestUrl: "https://other.test/x", fetchedAt: NOW });
  });
  it("sends POST bodies as JSON with headers", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock);
    await t.request({ url: "https://other.test/x", method: "POST", headers: { a: "b" }, body: { q: 1 } });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ method: "POST", headers: { a: "b" }, body: '{"q":1}' });
  });
  it("throws a SourceError with the status for non-retryable HTTP failures", async () => {
    const fetcher = vi.fn(async () => new Response("<html>boom</html>", { status: 500 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock);
    const err = await t.request({ url: "https://other.test/x?token=abc" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect((err as SourceError).status).toBe(500);
    expect((err as Error).message).toBe("http: HTTP 500 https://other.test/x");
  });
  it.each([
    ["an IP address", { error: "blocked 203.0.113.9" }],
    ["credential words", { error: "bad api key supplied" }],
    ["a non-string error", { error: { nested: true } }],
    ["an empty error", { error: "" }],
  ])("omits error detail containing %s", async (_n, payload) => {
    const t = new FetchTransport(vi.fn(async () => new Response(JSON.stringify(payload), { status: 400 })) as unknown as typeof fetch, clock);
    await expect(t.request({ url: "https://other.test/x" })).rejects.toThrow(/^http: HTTP 400 https:\/\/other\.test\/x$/);
  });
  it("includes and truncates safe JSON error detail to 160 chars", async () => {
    const t = new FetchTransport(vi.fn(async () => new Response(JSON.stringify({ error: "x".repeat(300) }), { status: 400 })) as unknown as typeof fetch, clock);
    const err = await t.request({ url: "https://other.test/x" }).catch((e: Error) => e);
    expect((err as Error).message.endsWith(`: ${"x".repeat(160)}`)).toBe(true);
  });
  it("gives up after the retry limit on repeated 429s", async () => {
    const sleeps: number[] = [];
    const fetcher = vi.fn(async () => new Response("slow down", { status: 429 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock, async ms => { sleeps.push(ms); });
    await expect(t.request({ url: "https://other.test/x" })).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });
  it("uses an HTTP-date Retry-After relative to the injected clock", async () => {
    const sleeps: number[] = [];
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "Sat, 24 Oct 2026 04:40:07 GMT" } }))
      .mockResolvedValueOnce(new Response("fine", { status: 200 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock, async ms => { sleeps.push(ms); });
    await t.request({ url: "https://other.test/x" });
    expect(sleeps).toEqual([7000]);
  });
  it("uses global fetch and real timers by default", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = new FetchTransport();
    const pending = t.request({ url: "https://other.test/default" });
    await vi.runAllTimersAsync();
    expect((await pending).body).toBe("done");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("passes unparseable URLs through to the fetcher without a rate bucket", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock);
    await t.request({ url: "not a url" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=synthetic",
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?api_key=",
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
    "https://npiregistry.cms.hhs.gov/api/?version=2.1",
    "https://clinicaltrials.gov/api/v2/studies",
  ])("routes known host %s through its shared limiter", async url => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const t = new FetchTransport(fetcher as unknown as typeof fetch, clock);
    const pending = t.request({ url });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("FixtureTransport", () => {
  let root = "";
  const manifest = [
    { file: "a.json", url: "https://api.test/one", fetched_at: NOW, status: 200 },
    { file: "dup1.json", url: "https://api.test/dup", fetched_at: NOW, status: 200 },
    { file: "dup2.json", url: "https://api.test/dup", fetched_at: NOW, status: 200 },
    { file: "post.json", url: "https://api.test/post", method: "POST", fetched_at: NOW, status: 200 },
    { file: "fail.json", url: "https://api.test/fail", fetched_at: NOW, status: 404 },
  ];
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "wf-fixture-"));
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "MANIFEST.json"), JSON.stringify(manifest));
    for (const f of ["a.json", "dup1.json", "post.json", "fail.json", "unlisted.json"]) await writeFile(join(root, f), `{"f":"${f}"}`);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("replays the single matching manifest entry for a GET", async () => {
    const res = await new FixtureTransport(root).request({ url: "https://api.test/one" });
    expect(res).toMatchObject({ body: '{"f":"a.json"}', status: 200, fetchedAt: NOW, requestUrl: "https://api.test/one" });
  });
  it("refuses ambiguous URLs without an explicit key", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/dup" })).rejects.toThrow("explicit fixture key");
  });
  it("resolves aliases through the keys map", async () => {
    const res = await new FixtureTransport(root, { alias: "dup1.json" }).request({ url: "https://api.test/dup", key: "alias" });
    expect(res.body).toContain("dup1.json");
  });
  it("replays POST fixtures when a key and matching method are given", async () => {
    const res = await new FixtureTransport(root).request({ url: "https://api.test/post", method: "POST", key: "post.json" });
    expect(res.body).toContain("post.json");
  });
  it("rejects a fixture used with the wrong method", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/post", key: "post.json" })).rejects.toThrow("different endpoint or method");
  });
  it("rejects a fixture used for a different endpoint", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/other", key: "a.json" })).rejects.toThrow("different endpoint or method");
  });
  it("rejects files without manifest provenance", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/one", key: "unlisted.json" })).rejects.toThrow("Missing manifest provenance");
  });
  it("surfaces recorded failures with their status", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/fail" })).rejects.toMatchObject({ status: 404, message: "fixture: Recorded request failed" });
  });
  it("rejects keys that escape the fixture root", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/one", key: "../outside.json" })).rejects.toThrow("Invalid fixture path");
  });
  it("rejects keys that traverse out through a subdirectory", async () => {
    await expect(new FixtureTransport(root).request({ url: "https://api.test/one", key: "sub/../../x" })).rejects.toThrow("Invalid fixture path");
  });
});
