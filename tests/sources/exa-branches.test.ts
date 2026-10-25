import { describe, expect, it, vi } from "vitest";
import { ExaClient } from "../../lib/sources/exa";
import { RateLimiter, type Transport } from "../../lib/sources/transport";

const NOW = "2026-10-24T04:40:00.000Z";
const immediate = () => new RateLimiter(1000, () => 0, async () => {});
function setup(payloads: unknown[], apiKey?: string) {
  const queue = [...payloads];
  const request = vi.fn(async () => {
    const next = queue.shift();
    return { body: typeof next === "string" ? next : JSON.stringify(next), fetchedAt: NOW, status: 200 };
  });
  return { exa: new ExaClient({ request } as Transport, apiKey, immediate()), request };
}
const page = (url: string, text?: string) => ({ url, title: "t", text });

describe("ExaClient.search", () => {
  it("asks for each page's outgoing links and passes string links through (capped), dropping the raw extras", async () => {
    const { exa, request } = setup([{ results: [{ ...page("https://a.test/p", "Apply online today"), extras: { links: ["/apply", 7, "https://a.test/x"] } }, page("https://a.test/q", "no extras")] }]);
    const res = await exa.search("q");
    const arg = (request.mock.calls[0] as unknown as [{ body: { contents: unknown } }])[0];
    expect(arg.body.contents).toEqual({ text: true, extras: { links: 60 } });
    expect(res.records[0]).toEqual({ url: "https://a.test/p", title: "t", text: "Apply online today", links: ["/apply", "https://a.test/x"] });
    expect(res.records[1]).not.toHaveProperty("links");
  });
  it("rejects blank queries without calling the transport", async () => {
    const { exa, request } = setup([]);
    await expect(exa.search("   ")).rejects.toThrow("Empty search query");
    expect(request).not.toHaveBeenCalled();
  });
  it("omits the api key header when none is configured", async () => {
    const { exa, request } = setup([{ results: [] }]);
    await exa.search("q");
    const arg = (request.mock.calls[0] as unknown as [{ headers: Record<string, string>; body: { numResults: number } }])[0];
    expect(arg.headers).toEqual({ "content-type": "application/json" });
    expect(arg.body.numResults).toBe(10);
  });
  it("sends the api key, numResults and fixture key when provided", async () => {
    const { exa, request } = setup([{ results: [] }], "synthetic-key");
    await exa.search("q", { numResults: 3, key: "fx" });
    const arg = (request.mock.calls[0] as unknown as [{ headers: Record<string, string>; body: { numResults: number }; key: string }])[0];
    expect(arg.headers["x-api-key"]).toBe("synthetic-key");
    expect(arg.body.numResults).toBe(3);
    expect(arg.key).toBe("fx");
  });
  it("de-duplicates by URL and emits evidence only for pages with text", async () => {
    const { exa } = setup([{ results: [page("https://a.test/1", "  hello  "), page("https://a.test/1", "dup"), page("https://a.test/2"), page("https://a.test/3", "   ")] }]);
    const res = await exa.search("q");
    expect(res.records.map(r => r.url)).toEqual(["https://a.test/1", "https://a.test/2", "https://a.test/3"]);
    expect(res.evidence).toHaveLength(1);
    expect(res.evidence[0]).toMatchObject({ sourceKind: "exa", claim: "dup", claimType: "page_excerpt" });
  });
  it("truncates excerpts to 1000 characters", async () => {
    const { exa } = setup([{ results: [page("https://a.test/1", "y".repeat(2000))] }]);
    expect((await exa.search("q")).evidence[0].claim).toHaveLength(1000);
  });
  it.each([
    ["error field", { error: "nope", results: [] }],
    ["missing results", {}],
    ["non-array results", { results: "x" }],
  ])("rejects invalid responses: %s", async (_n, payload) => {
    const { exa } = setup([payload]);
    await expect(exa.search("q")).rejects.toThrow("Invalid search/contents response");
  });
  it.each(["ftp://a.test/file", "javascript:alert(1)", "not a url"])("rejects result URL %s", async url => {
    const { exa } = setup([{ results: [page(url, "t")] }]);
    await expect(exa.search("q")).rejects.toThrow("Invalid result URL");
  });
  it("rejects malformed JSON", async () => {
    const { exa } = setup(["{bad"]);
    await expect(exa.search("q")).rejects.toThrow("Invalid JSON response");
  });
});

describe("ExaClient.contents", () => {
  it("refuses URLs that search did not return", async () => {
    const { exa, request } = setup([]);
    await expect(exa.contents(["https://a.test/x"])).rejects.toThrow("was not returned by this client's search");
    expect(request).not.toHaveBeenCalled();
  });
  it("returns an empty result for an empty URL list without a request", async () => {
    const { exa, request } = setup([]);
    expect(await exa.contents([])).toEqual({ records: [], evidence: [] });
    expect(request).not.toHaveBeenCalled();
  });
  it("fetches contents for URLs previously returned by search", async () => {
    const { exa, request } = setup([{ results: [page("https://a.test/1")] }, { results: [page("https://a.test/1", "full text")] }]);
    await exa.search("q");
    const res = await exa.contents(["https://a.test/1"], "fx2");
    expect(res.evidence[0].claim).toBe("full text");
    expect((request.mock.calls[1] as unknown as [{ key: string }])[0].key).toBe("fx2");
  });
  it("rejects contents results that were not requested", async () => {
    const { exa } = setup([{ results: [page("https://a.test/1"), page("https://a.test/2")] }, { results: [page("https://a.test/2", "t")] }]);
    await exa.search("q");
    await expect(exa.contents(["https://a.test/1"])).rejects.toThrow("Unexpected contents URL");
  });
});
