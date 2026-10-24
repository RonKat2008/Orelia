import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { identityAgent } from "@/lib/agents/research/identity";
import { literatureAgent } from "@/lib/agents/research/literature";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import { verify } from "@/lib/agents/verifier";
import { expertEligibility } from "@/lib/identity/eligibility";
import { researchResultSchema } from "@/lib/contracts";

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
