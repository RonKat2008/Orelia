import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { jsonError, parseBody } from "../../app/api/cases/_lib/http";

afterEach(() => vi.restoreAllMocks());

describe("jsonError", () => {
  it("never returns details for 5xx; logs them server-side", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("connect ECONNREFUSED 10.0.0.5 apikey=sk-secret");
    for (const status of [500, 502]) {
      const res = jsonError(status, "Something failed", err);
      const text = JSON.stringify(await res.json());
      expect(res.status).toBe(status);
      expect(text).toBe('{"error":"Something failed"}');
      expect(text).not.toMatch(/ECONNREFUSED|sk-secret|stack/);
    }
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]).toEqual(["[api 500] Something failed", "Error: connect ECONNREFUSED 10.0.0.5 apikey=sk-secret"]);
  });
  it("logs nothing when there are no details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await jsonError(404, "Case not found").json()).toEqual({ error: "Case not found" });
    expect(spy).not.toHaveBeenCalled();
  });
  it("drops object details and ignores fields on non-400", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await jsonError(409, "x", { secret: 1 }, ["a"]).json()).toEqual({ error: "x" });
  });
});

describe("parseBody", () => {
  it("returns only field paths on validation failure", async () => {
    const schema = z.object({ name: z.string(), nested: z.object({ n: z.number() }) });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ name: 5, nested: { n: "secret-value" } }) });
    const r = await parseBody(req, schema);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const body = await r.response.json();
    expect(r.response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid body", fields: ["name", "nested.n"] });
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });
  it("rejects invalid JSON generically", async () => {
    const r = await parseBody(new Request("http://x", { method: "POST", body: "{" }), z.object({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await r.response.json()).toEqual({ error: "Body must be valid JSON" });
  });
});
