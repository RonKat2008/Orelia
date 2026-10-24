import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { identityAgent } from "@/lib/agents/research/identity";
import { literatureAgent } from "@/lib/agents/research/literature";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { createLivePorts } from "@/lib/agents/research/live-ports";
import type { PubmedAuthorHit } from "@/lib/agents/research/source-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { verify } from "@/lib/agents/verifier";
import { expertEligibility } from "@/lib/identity/eligibility";
import { researchResultSchema } from "@/lib/contracts";
import { RateLimiter } from "@/lib/sources";

const runtime = vi.hoisted(() => ({ override: null as null | (() => unknown) }));
vi.mock("@/lib/agents/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/runtime")>();
  return { ...actual, runAgent: (options: Parameters<typeof actual.runAgent>[0]) => runtime.override ? runtime.override() : actual.runAgent(options) };
});

beforeEach(() => vi.stubEnv("WAYFINDER_OFFLINE", "1"));
afterEach(() => { runtime.override = null; vi.unstubAllEnvs(); });

it("rejects Li, corroborates Gardner's actual pathology identity, and keeps both out of the shortlist", async () => {
  const c = { diseaseName: "Epithelioid sarcoma", goals: [] };
  const ctx = { ports: createFixturePorts({ strict: false }), store: new MemoryRunStore(), caseId: "identity-regression" };
  const identity = await identityAgent.run(c, ctx);
  expect(researchResultSchema.safeParse(identity).success).toBe(true);
  const literature = await literatureAgent.run(c, ctx);
  const output = verify([literature, identity], c);
  const li = output.kept.find((r) => r.resource.kind === "expert" && r.resource.name === "Liping Li")!;
  const gardner = output.kept.find((r) => r.resource.kind === "expert" && r.resource.name === "Jerad Gardner")!;
  expect(li.resource).toMatchObject({ verified: false });
  expect(li.resource.kind === "expert" && (li.resource.npi ?? null)).toBeNull();
  expect(li.evidence.some((e) => /trainee/.test(e.claim))).toBe(true);
  expect(gardner.resource).toMatchObject({ npi: "1568608651", verified: true, profile: { paperCount: 1 } });
  expect(gardner.evidence.some((e) => /NPI verified:.*Pathology.*DANVILLE PA, matches affiliation/.test(e.claim))).toBe(true);
  for (const rec of [li, gardner]) {
    expect(rec.shortlistEligibility?.eligible).toBe(false);
    if (rec.resource.kind === "expert") expect(expertEligibility(rec.resource, output.kept.map((r) => r.resource)).eligible).toBe(false);
  }
});

it("returns only code-stamped identity claims, never the old model trainee verification", async () => {
  const result = await identityAgent.run({ diseaseName: "Epithelioid sarcoma", goals: [] }, { ports: createFixturePorts({ strict: false }), store: new MemoryRunStore(), caseId: "identity-claims" });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  const li = result.records.find((r) => r.kind === "expert" && r.name === "Liping Li")!;
  const evidence = result.evidence.filter((e) => li.evidenceRefs.includes(e.sourceUrl));
  expect(evidence).toHaveLength(1);
  expect(evidence[0]?.claimType).toBe("identity_unverified");
  expect(evidence[0]?.claim).toContain("NPI rejected");
});

it("cannot transfer another author's verified NPI or credential through model output", async () => {
  const url = "https://npiregistry.cms.hhs.gov/provider-view/1568608651";
  runtime.override = () => ({ records: [{ kind: "expert", id: "forged", name: "Liping Li", npi: "1568608651", credentials: "MD", evidenceRefs: [url] }], evidence: [{ claimType: "identity_verified", claim: "Verified expert", sourceUrl: url }] });
  const result = await identityAgent.run({ diseaseName: "Epithelioid sarcoma", goals: [] }, { ports: createFixturePorts({ strict: false }), store: new MemoryRunStore(), caseId: "identity-transfer" });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.records[0]).toMatchObject({ npi: null, verified: false });
  expect(result.records[0]?.kind === "expert" && result.records[0].credentials).toBeUndefined();
    expect(result.evidence.every((e) => e.claimType === "identity_unverified")).toBe(true);
});

it("keeps the NPI from a recorded live NPPES response when PubMed lists one author twice", async () => {
  const body = await readFile("fixtures/api/nppes/live-gardner.json", "utf8");
  const instant = () => new RateLimiter(1000, () => 0, async () => {});
  const live = createLivePorts({
    transport: { request: async (r) => ({ body, status: 200, fetchedAt: "2026-10-24T00:00:00.000Z", requestUrl: r.url }) },
    env: {},
    limiters: { nppes: instant(), pubmed: instant(), ctgov: instant(), exa: instant() },
  });
  const author = (middle: string | undefined, pmid: string): PubmedAuthorHit => ({
    name: "Jerad Gardner",
    firstName: "Jerad",
    lastName: "Gardner",
    ...(middle ? { middleName: middle } : {}),
    affiliation: "Department of Pathology, Geisinger Medical Center, Danville, PA",
    affiliations: ["Department of Pathology, Geisinger Medical Center, Danville, PA"],
    state: "PA",
    paperCount: 1,
    recentPaperCount: 1,
    papers: [{ pmid, title: "Epithelioid sarcoma review", year: 2024 }],
  });
  const url = "https://npiregistry.cms.hhs.gov/provider-view/1568608651";
  runtime.override = () => ({
    records: [{ kind: "expert", id: "expert:jerad-gardner", name: "Jerad Gardner", npi: null, evidenceRefs: [url] }],
    evidence: [{ claimType: "identity_unverified", claim: "lookup", sourceUrl: url }],
  });
  const result = await identityAgent.run(
    { diseaseName: "Epithelioid sarcoma", goals: [] },
    { ports: { ...live, pubmed: { searchAuthors: async () => [author(undefined, "1"), author("M", "2")] } }, store: new MemoryRunStore(), caseId: "live-nppes" },
  );
  expect(result.status).toBe("ok");
  if (result.status !== "ok") return;
  expect(result.records[0]).toMatchObject({ npi: "1568608651", verified: true, credentials: "MD" });
  expect(result.evidence.some((e) => e.claimType === "identity_verified" && e.sourceUrl === url)).toBe(true);
});

it.each(["Epithelioid sarcoma", "Vascular Ehlers-Danlos syndrome", "IgG4-related disease"])(
  "strict recorded sample yields shortlist-eligible, identity-verified experts for %s",
  async (diseaseName) => {
    const c = { diseaseName, goals: [] };
    const ctx = { ports: createFixturePorts(), store: new MemoryRunStore(), caseId: "strict-sample" };
    const output = verify([await literatureAgent.run(c, ctx), await identityAgent.run(c, ctx)], c);
    const eligible = output.kept.filter((r) => r.resource.kind === "expert" && r.shortlistEligibility?.eligible);
    expect(eligible.length).toBeGreaterThan(0);
    for (const r of eligible) expect(r.resource).toMatchObject({ verified: true });
  },
);
