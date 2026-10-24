import { describe, expect, it, vi } from "vitest";
import { CtgovClient } from "../../lib/sources/ctgov";
import { RateLimiter, type Transport } from "../../lib/sources/transport";

const NOW = "2026-10-24T04:40:00.000Z";
const immediate = () => new RateLimiter(1000, () => 0, async () => {});
function client(pages: unknown[]) {
  const queue = [...pages];
  const request = vi.fn(async () => {
    const next = queue.shift();
    return { body: typeof next === "string" ? next : JSON.stringify(next), fetchedAt: NOW, status: 200 };
  });
  return { c: new CtgovClient({ request } as Transport, immediate()), request };
}
const study = (id: string, over: Record<string, unknown> = {}) => ({
  protocolSection: { identificationModule: { nctId: id, briefTitle: `Brief ${id}` }, statusModule: { overallStatus: "RECRUITING" } },
  ...over,
});

describe("CtgovClient.recruitingStudies", () => {
  it("rejects blank diseases without a request", async () => {
    const { c, request } = client([]);
    await expect(c.recruitingStudies("  ")).rejects.toThrow("Empty disease query");
    expect(request).not.toHaveBeenCalled();
  });
  it("applies minimal defaults when optional registry modules are absent", async () => {
    const { c, request } = client([{ studies: [study("NCT00000001")] }]);
    const res = await c.recruitingStudies("sarcoma");
    expect(res.records).toEqual([{
      nctId: "NCT00000001", title: "Brief NCT00000001", status: "RECRUITING", phases: [], sponsor: undefined,
      investigators: [], contacts: [], sites: [], sourceUrl: "https://clinicaltrials.gov/study/NCT00000001",
      conditions: [], keywords: [], meshTerms: [], stdAges: [], minimumAge: undefined, maximumAge: undefined,
    }]);
    expect(res.evidence[0]).toMatchObject({ sourceKind: "ctgov", claimType: "recruiting_study", fetchedAt: NOW });
    const u = new URL((request.mock.calls[0] as unknown as [{ url: string }])[0].url);
    expect(u.searchParams.get("pageSize")).toBe("20");
    expect(u.searchParams.has("pageToken")).toBe(false);
  });
  it("falls back from briefTitle to officialTitle to the NCT id", async () => {
    const s = (id: string, ident: Record<string, unknown>) => ({ protocolSection: { identificationModule: { nctId: id, ...ident }, statusModule: { overallStatus: "RECRUITING" } } });
    const { c } = client([{ studies: [s("NCT00000001", { officialTitle: "Official" }), s("NCT00000002", {})] }]);
    expect((await c.recruitingStudies("x")).records.map(r => r.title)).toEqual(["Official", "NCT00000002"]);
  });
  it("maps all optional registry fields and skips mesh entries without a term", async () => {
    const full = study("NCT00000003", {
      derivedSection: { conditionBrowseModule: { meshes: [{ term: "Sarcoma" }, {}] } },
    });
    Object.assign(full.protocolSection, {
      designModule: { phases: ["PHASE2"] },
      sponsorCollaboratorsModule: { leadSponsor: { name: "Synthetic Sponsor" } },
      conditionsModule: { conditions: ["Sarcoma"], keywords: ["rare"] },
      eligibilityModule: { stdAges: ["ADULT"], minimumAge: "18 Years", maximumAge: "80 Years" },
      contactsLocationsModule: { overallOfficials: [{ name: "Dr A" }], centralContacts: [{ email: "x@example.test" }], locations: [{ facility: "Site" }] },
    });
    const { c } = client([{ studies: [full] }]);
    const [r] = (await c.recruitingStudies("sarcoma")).records;
    expect(r).toMatchObject({ phases: ["PHASE2"], sponsor: "Synthetic Sponsor", conditions: ["Sarcoma"], keywords: ["rare"], meshTerms: ["Sarcoma"], stdAges: ["ADULT"], minimumAge: "18 Years", maximumAge: "80 Years", investigators: [{ name: "Dr A" }], sites: [{ facility: "Site" }] });
  });
  it("skips studies that are not currently recruiting", async () => {
    const closed = { protocolSection: { identificationModule: { nctId: "NCT00000004" }, statusModule: { overallStatus: "COMPLETED" } } };
    const noStatus = { protocolSection: { identificationModule: { nctId: "NCT00000005" } } };
    const { c } = client([{ studies: [closed, noStatus, study("NCT00000006")] }]);
    expect((await c.recruitingStudies("x")).records.map(r => r.nctId)).toEqual(["NCT00000006"]);
  });
  it.each([
    ["missing protocolSection", {}],
    ["missing nctId", { protocolSection: { identificationModule: {} } }],
    ["malformed nctId", study("NCT123")],
  ])("rejects studies with an invalid identifier: %s", async (_n, s) => {
    const { c } = client([{ studies: [s] }]);
    await expect(c.recruitingStudies("x")).rejects.toThrow("Invalid study identifier");
  });
  it("rejects responses without a studies array and malformed JSON", async () => {
    await expect(client([{ message: "oops" }]).c.recruitingStudies("x")).rejects.toThrow("Missing studies array");
    await expect(client(["{bad"]).c.recruitingStudies("x")).rejects.toThrow("Invalid JSON response");
  });
  it("follows page tokens, passes per-page fixture keys and de-duplicates studies by id", async () => {
    const { c, request } = client([
      { studies: [study("NCT00000001")], nextPageToken: "t1" },
      { studies: [study("NCT00000001"), study("NCT00000002")] },
    ]);
    const res = await c.recruitingStudies("x", { pageSize: 5, keys: ["k0", "k1"] });
    expect(res.records.map(r => r.nctId)).toEqual(["NCT00000001", "NCT00000002"]);
    expect(res.evidence).toHaveLength(2);
    const calls = request.mock.calls as unknown as [{ url: string; key?: string }][];
    expect(new URL(calls[1][0].url).searchParams.get("pageToken")).toBe("t1");
    expect(new URL(calls[1][0].url).searchParams.get("pageSize")).toBe("5");
    expect(calls.map(x => x[0].key)).toEqual(["k0", "k1"]);
  });
  it("fails closed when the registry repeats a pagination token", async () => {
    const { c } = client([
      { studies: [], nextPageToken: "t1" },
      { studies: [], nextPageToken: "t1" },
    ]);
    await expect(c.recruitingStudies("x")).rejects.toThrow("Repeated pagination token");
  });
  it("fails closed when the page limit is reached before the last page", async () => {
    const { c } = client([{ studies: [], nextPageToken: "a" }, { studies: [], nextPageToken: "b" }]);
    await expect(c.recruitingStudies("x", { maxPages: 2 })).rejects.toThrow("Pagination limit reached");
  });
  it("fails immediately with a zero page budget", async () => {
    const { c, request } = client([]);
    await expect(c.recruitingStudies("x", { maxPages: 0 })).rejects.toThrow("Pagination limit reached");
    expect(request).not.toHaveBeenCalled();
  });
  it("builds its own default limiter", () => {
    expect(new CtgovClient({ request: vi.fn() } as Transport)).toBeInstanceOf(CtgovClient);
  });
});
