import { describe, expect, it } from "vitest";
import { createLivePorts } from "@/lib/agents/research/live-ports";
import { FixtureTransport, RateLimiter, loadNciCenters } from "@/lib/sources";

const SLUG = "epithelioid-sarcoma";
const instant = () => new RateLimiter(1000, () => 0, async () => {});

/** FixtureTransport replays only recorded requests, so route each live query to its recorded file. */
function keyFor(r: { url: string; method?: string; body?: unknown }): string | undefined {
  const u = new URL(r.url);
  if (u.pathname.endsWith("esearch.fcgi")) return `pubmed/${SLUG}/esearch.json`;
  if (u.pathname.endsWith("efetch.fcgi")) return `pubmed/${SLUG}/efetch.xml`;
  if (u.hostname === "clinicaltrials.gov") return `ctgov/${SLUG}/studies.json`;
  if (u.hostname === "npiregistry.cms.hhs.gov") {
    const first = u.searchParams.get("first_name")?.toLowerCase();
    const last = u.searchParams.get("last_name")?.toLowerCase();
    return `nppes/${SLUG}/${last}-${first}.json`;
  }
  if (u.hostname === "api.exa.ai") return `exa/${SLUG}/1.json`;
  return undefined;
}

function ports() {
  return createLivePorts({
    transport: new FixtureTransport(),
    env: { NCBI_API_KEY: "test-key", EXA_API_KEY: "test-key" },
    now: () => new Date("2026-10-24T00:00:00Z"),
    limiters: { pubmed: instant(), ctgov: instant(), nppes: instant(), exa: instant() },
    keyFor,
  });
}

describe("createLivePorts (FixtureTransport, no network)", () => {
  it("pubmed: aggregates authors with counts, recent counts and papers", async () => {
    const authors = await ports().pubmed.searchAuthors({ disease: "epithelioid sarcoma", limit: 5 });
    expect(authors.length).toBeGreaterThan(0);
    expect(authors.length).toBeLessThanOrEqual(5);
    for (const a of authors) {
      expect(a.firstName.length).toBeGreaterThan(1);
      expect(a.paperCount).toBe(a.papers.length);
      expect(a.recentPaperCount).toBeLessThanOrEqual(a.paperCount);
    }
    const counts = authors.map((a) => a.paperCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("ctgov: carries registry eligibility and condition fields", async () => {
    const studies = await ports().ctgov.recruitingStudies({ condition: "epithelioid sarcoma" });
    const hh = studies.find((s) => s.nctId === "NCT04390737");
    expect(hh?.conditions).toContain("Epithelioid Sarcoma");
    expect(hh?.stdAges).toEqual(["ADULT", "OLDER_ADULT"]);
    expect(hh?.minimumAge).toBe("18 Years");
    expect(hh?.sites.some((s) => s.country === "United States")).toBe(true);
    expect(hh?.hasContact).toBe(true);
    expect(hh?.investigators).toContain("Fugen Li");
  });

  it("nppes: maps providers and builds the registry search URL", async () => {
    const result = await ports().nppes.lookup({ firstName: "Ritu", lastName: "Nayar", state: "IL" });
    expect(result.searchUrl).toContain("npiregistry.cms.hhs.gov/api/");
    expect(result.searchUrl).toContain("last_name=Nayar");
    expect(result.providers.length).toBeGreaterThan(0);
    expect(result.providers[0]?.npi).toMatch(/^\d{10}$/);
  });

  it("exa: returns url/title/text from the recorded search", async () => {
    const results = await ports().exa.search({ query: "epithelioid sarcoma advocacy foundation" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => /^https?:\/\//.test(r.url) && r.title.length > 0)).toBe(true);
  });

  it("centers: cancer diseases get nearby comprehensive centers; others get none", async () => {
    const p = createLivePorts({ transport: new FixtureTransport(), env: {}, nciDataset: await loadNciCenters() });
    const near = await p.centers.match({ diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600 });
    expect(near[0]?.state).toBe("AZ");
    expect(near.length).toBeLessThanOrEqual(8);
    expect(near.every((c) => c.url.startsWith("https://www.cancer.gov/"))).toBe(true);
    expect(await p.centers.match({ diseaseName: "IgG4-related disease", homeState: "NC" })).toEqual([]);
    expect(await p.centers.match({ diseaseName: "Epithelioid sarcoma" })).toEqual([]);
  });

  it("never touches the network: a request with no recorded fixture fails closed", async () => {
    const p = createLivePorts({
      transport: new FixtureTransport(),
      env: {},
      limiters: { exa: instant() },
    });
    await expect(p.exa.search({ query: "anything" })).rejects.toThrow();
  });
});
