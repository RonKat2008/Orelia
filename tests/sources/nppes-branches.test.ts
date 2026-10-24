import { describe, expect, it, vi } from "vitest";
import { NppesClient, type NppesProvider } from "../../lib/sources/nppes";
import { RateLimiter, type SourceResponse, type Transport } from "../../lib/sources/transport";

const NOW = "2026-10-24T04:40:00.000Z";
const immediate = () => new RateLimiter(1000, () => 0, async () => {});
type Row = Omit<NppesProvider, "number"> & { number: string | number };
function row(over: Partial<Row> = {}): Row {
  return {
    number: "1234567890", enumeration_type: "NPI-1",
    basic: { first_name: "Ada", last_name: "Synthetic", status: "A", organization_name: "Example Clinic", credential: "MD" },
    addresses: [{ state: "PA", city: "Philadelphia" }],
    taxonomies: [{ code: "207RH0000X", desc: "Hematology" }],
    ...over,
  };
}
function client(payload: unknown, extra: Partial<SourceResponse> = {}) {
  const request = vi.fn(async () => ({ body: typeof payload === "string" ? payload : JSON.stringify(payload), fetchedAt: NOW, status: 200, ...extra }));
  return { c: new NppesClient({ request } as Transport, immediate()), request };
}
const full = { firstName: "Ada", lastName: "Synthetic", state: "pa", taxonomy: "207RH0000X", affiliation: "example clinic" };

describe("NppesClient input validation", () => {
  it.each([
    [{ firstName: " ", lastName: "X" }],
    [{ firstName: "X", lastName: "" }],
  ])("rejects blank names %j", async q => {
    const { c, request } = client({});
    await expect(c.lookup(q)).rejects.toThrow("Both names are required");
    expect(request).not.toHaveBeenCalled();
  });
  it.each([0, 201, 1.5, Number.NaN])("rejects limit %s", async limit => {
    const { c } = client({});
    await expect(c.lookup({ firstName: "A", lastName: "B", limit })).rejects.toThrow("Limit must be 1..200");
  });
});

describe("NppesClient response handling", () => {
  it("builds the query URL with state and forwards the fixture key", async () => {
    const { c, request } = client({ result_count: 0, results: [] });
    await c.lookup({ firstName: "Ada", lastName: "Synthetic", state: "PA", key: "k1", limit: 5 });
    const arg = (request.mock.calls[0] as unknown as [{ url: string; key?: string }])[0];
    const u = new URL(arg.url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ version: "2.1", first_name: "Ada", last_name: "Synthetic", limit: "5", state: "PA" });
    expect(arg.key).toBe("k1");
  });
  it("omits state from the URL when not provided", async () => {
    const { c, request } = client({ result_count: 0, results: [] });
    await c.lookup({ firstName: "Ada", lastName: "Synthetic" });
    const arg = (request.mock.calls[0] as unknown as [{ url: string }])[0];
    expect(new URL(arg.url).searchParams.has("state")).toBe(false);
    expect(new URL(arg.url).searchParams.get("limit")).toBe("200");
  });
  it("reports not_found for an empty registry result", async () => {
    const { c } = client({ result_count: 0, results: [] });
    expect(await c.lookup({ firstName: "A", lastName: "B" })).toMatchObject({ status: "not_found", reason: "No registry matches", records: [], evidence: [] });
  });
  it.each([
    ["Errors present", { Errors: [{ description: "bad" }], result_count: 0, results: [] }],
    ["results missing", { result_count: 0 }],
    ["result_count not a number", { result_count: "1", results: [] }],
  ])("throws on invalid registry response: %s", async (_n, payload) => {
    const { c } = client(payload);
    await expect(c.lookup({ firstName: "A", lastName: "B" })).rejects.toThrow("Invalid registry response");
  });
  it("throws on malformed JSON and HTTP errors", async () => {
    await expect(client("<html>").c.lookup({ firstName: "A", lastName: "B" })).rejects.toThrow("Invalid JSON response");
    await expect(client("{}", { status: 503 }).c.lookup({ firstName: "A", lastName: "B" })).rejects.toThrow("HTTP 503");
  });
  it("rejects a provider with a malformed NPI", async () => {
    const { c } = client({ result_count: 1, results: [row({ number: "123" })] });
    await expect(c.lookup({ firstName: "A", lastName: "B" })).rejects.toThrow("Invalid provider record");
  });
  it("rejects a provider with no basic block", async () => {
    const { c } = client({ result_count: 1, results: [{ number: "1234567890" }] });
    await expect(c.lookup({ firstName: "A", lastName: "B" })).rejects.toThrow("Invalid provider record");
  });
  it("accepts numeric NPIs and de-duplicates repeated records", async () => {
    const { c } = client({ result_count: 2, results: [row({ number: 1234567890 }), row({ number: "1234567890" })] });
    const res = await c.lookup({ firstName: "Ada", lastName: "Synthetic" });
    expect(res.records).toHaveLength(1);
    expect(res.records[0].number).toBe("1234567890");
  });
});

describe("NppesClient identity verification", () => {
  it("verifies a unique, fully corroborated active individual", async () => {
    const { c } = client({ result_count: 1, results: [row()] });
    const res = await c.lookup(full);
    expect(res.status).toBe("verified");
    expect(res.records).toHaveLength(1);
    expect(res.evidence[0]).toMatchObject({ sourceKind: "nppes", sourceUrl: "https://npiregistry.cms.hhs.gov/provider-view/1234567890", claimType: "registry_listing" });
    expect(res.evidence[0].claim).toContain("MD");
  });
  it("matches taxonomy by description when the code differs", async () => {
    const { c } = client({ result_count: 1, results: [row()] });
    expect((await c.lookup({ ...full, taxonomy: "hematology" })).status).toBe("verified");
  });
  it("stays ambiguous when taxonomy does not match", async () => {
    const { c } = client({ result_count: 1, results: [row()] });
    const res = await c.lookup({ ...full, taxonomy: "Cardiology" });
    expect(res.status).toBe("ambiguous");
    expect(res.records).toHaveLength(1);
    expect(res.reason).toContain("requires corroboration");
  });
  it("stays ambiguous when the provider has no taxonomies or addresses", async () => {
    const { c } = client({ result_count: 1, results: [row({ taxonomies: undefined, addresses: undefined })] });
    expect((await c.lookup(full)).status).toBe("ambiguous");
  });
  it("stays ambiguous when the affiliation does not match", async () => {
    const { c } = client({ result_count: 1, results: [row()] });
    expect((await c.lookup({ ...full, affiliation: "Other Hospital" })).status).toBe("ambiguous");
  });
  it("stays ambiguous when the provider lists no organization", async () => {
    const { c } = client({ result_count: 1, results: [row({ basic: { first_name: "Ada", last_name: "Synthetic", status: "A" } })] });
    expect((await c.lookup({ ...full, affiliation: "" })).status).toBe("ambiguous");
  });
  it("never verifies on name alone", async () => {
    const { c } = client({ result_count: 1, results: [row()] });
    expect((await c.lookup({ firstName: "Ada", lastName: "Synthetic" })).status).toBe("ambiguous");
  });
  it.each([
    ["organization record", row({ enumeration_type: "NPI-2" })],
    ["inactive record", row({ basic: { first_name: "Ada", last_name: "Synthetic", status: "D", organization_name: "Example Clinic" } })],
    ["different first name", row({ basic: { first_name: "Bob", last_name: "Synthetic", status: "A", organization_name: "Example Clinic" } })],
    ["missing last name", row({ basic: { first_name: "Ada", status: "A", organization_name: "Example Clinic" } })],
    ["missing organization when affiliation requested", row({ basic: { first_name: "Ada", last_name: "Synthetic", status: "A" } })],
    ["missing names", row({ basic: { status: "A", organization_name: "Example Clinic" } })],
    ["different state", row({ addresses: [{ state: "NY" }] })],
    ["address without state", row({ addresses: [{ city: "Nowhere" }] })],
    ["taxonomy without code or desc", row({ taxonomies: [{}] })],
  ])("does not verify an %s", async (_n, r) => {
    const { c } = client({ result_count: 1, results: [r] });
    expect((await c.lookup(full)).status).toBe("ambiguous");
  });
  it("is ambiguous when two providers both match", async () => {
    const { c } = client({ result_count: 2, results: [row(), row({ number: "1234567891" })] });
    const res = await c.lookup(full);
    expect(res.status).toBe("ambiguous");
    expect(res.records).toHaveLength(2);
  });
  it("is ambiguous when the result set may be truncated by the recorded limit", async () => {
    const { c } = client({ result_count: 1, results: [row()] }, { requestUrl: "https://npiregistry.cms.hhs.gov/api/?limit=1" });
    expect((await c.lookup(full)).status).toBe("ambiguous");
  });
  it("uses the requested limit when the recorded URL has no limit parameter", async () => {
    const { c } = client({ result_count: 1, results: [row()] }, { requestUrl: "https://npiregistry.cms.hhs.gov/api/" });
    expect((await c.lookup(full)).status).toBe("verified");
  });
  it("verifies when the recorded limit comfortably exceeds the result count", async () => {
    const { c } = client({ result_count: 1, results: [row()] }, { requestUrl: "https://npiregistry.cms.hhs.gov/api/?limit=50" });
    expect((await c.lookup(full)).status).toBe("verified");
  });
  it("describes providers with missing optional fields in evidence", async () => {
    const { c } = client({ result_count: 1, results: [{ number: "1234567890", basic: {} }] });
    const res = await c.lookup({ firstName: "A", lastName: "B" });
    expect(res.evidence[0].claim).toContain("credentials not listed");
  });
});
