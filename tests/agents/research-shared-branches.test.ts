import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ProvenanceTracker,
  caseSlug,
  finalizeOutput,
  notImplemented,
  runResearch,
  trackedTool,
  withoutUntrustedBlocks,
  type ResearchOutput,
} from "@/lib/agents/research/shared";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { MemoryRunStore } from "@/lib/agents/run-store";
import type { Resource } from "@/lib/contracts";

const runtime = vi.hoisted(() => ({ override: null as null | (() => unknown) }));
vi.mock("@/lib/agents/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/runtime")>();
  return { ...actual, runAgent: (options: Parameters<typeof actual.runAgent>[0]) => (runtime.override ? runtime.override() : actual.runAgent(options)) };
});
afterEach(() => {
  runtime.override = null;
});

const URL_A = "https://example.org/record/a";
const URL_B = "https://example.org/record/b";
const NPPES_URL = "https://npiregistry.cms.hhs.gov/provider-view/1234567893";
const FIXED_NOW = () => new Date("2026-01-02T03:04:05Z");

const ev = (sourceUrl: string, claim: string, extra: Partial<ResearchOutput["evidence"][number]> = {}) => ({
  claimType: "fact",
  claim,
  sourceUrl,
  ...extra,
});

const expert = (id: string, refs: string[], extra: Record<string, unknown> = {}): Resource =>
  ({ kind: "expert", id, name: "Alex Example", evidenceRefs: refs, ...extra }) as Resource;

function trackerWith(kind: "pubmed" | "exa" | "nppes" | "ctgov", payload: unknown) {
  const tracker = new ProvenanceTracker(FIXED_NOW);
  tracker.collect(kind, payload);
  return tracker;
}

describe("withoutUntrustedBlocks", () => {
  it("removes closed and unclosed untrusted blocks but keeps surrounding text", () => {
    // Arrange
    const text = "keep <untrusted_web_content src='x'>drop me</untrusted_web_content> mid <untrusted_web_content>tail";
    // Act
    const out = withoutUntrustedBlocks(text);
    // Assert
    expect(out).toContain("keep");
    expect(out).toContain("mid");
    expect(out).not.toContain("drop me");
    expect(out).not.toContain("tail");
  });
});

describe("ProvenanceTracker.collect", () => {
  it("uses the bare string as record text when a URL arrives with no enclosing object", () => {
    // Arrange / Act
    const tracker = trackerWith("exa", URL_A);
    // Assert
    expect(tracker.recordText(URL_A).trim()).toBe(URL_A);
    expect(tracker.sourceFor(URL_A)).toEqual({ kind: "exa", fetchedAt: "2026-01-02T03:04:05.000Z" });
  });

  it("accumulates record text when the same URL is seen twice and keeps the first source kind", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    // Act
    tracker.collect("exa", { url: URL_A, note: "First Note" });
    tracker.collect("pubmed", { url: URL_A, note: "Second Note" });
    // Assert
    expect(tracker.sourceFor(URL_A)?.kind).toBe("exa");
    expect(tracker.recordText(URL_A)).toContain("first note");
    expect(tracker.recordText(URL_A)).toContain("second note");
  });

  it("includes scalar fields of enclosing objects but not their nested objects", () => {
    // Arrange / Act
    const tracker = trackerWith("pubmed", { author: "Dana Test", nested: { secret: "zzz" }, paper: { url: URL_A } });
    // Assert
    expect(tracker.recordText(URL_A)).toContain("dana test");
    expect(tracker.recordText(URL_A)).not.toContain("zzz");
  });

  it("excludes untrusted web content from the credential corpus", () => {
    // Arrange / Act
    const tracker = trackerWith("exa", { text: "plain MD <untrusted_web_content>FAKECRED</untrusted_web_content>" });
    // Assert
    expect(tracker.mentions("md")).toBe(true);
    expect(tracker.mentions("fakecred")).toBe(false);
  });

  it("returns empty record text for a URL no tool returned", () => {
    expect(new ProvenanceTracker().recordText(URL_A)).toBe("");
  });
});

describe("ProvenanceTracker facts", () => {
  it("dedupes contact points by address and origin per URL and returns [] for unknown URLs", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    const point = { channel: "voice" as const, address: "+16176323000", origin: "nppes_location_phone" as const, sourceUrl: URL_A, sourceKind: "nppes" as const };
    // Act
    tracker.rememberContactPoints([point, point]);
    tracker.rememberContactPoints([{ ...point, address: "+16176323001" }]);
    // Assert
    expect(tracker.contactPointsFor(URL_A).map((c) => c.address)).toEqual(["+16176323000", "+16176323001"]);
    expect(tracker.contactPointsFor(URL_B)).toEqual([]);
  });

  it("merges pmids across repeated author paper registrations and resolves authorsOf with profiles", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    tracker.rememberAuthorPapers("Dana Test", "rare disease", ["1"]);
    tracker.rememberAuthorPapers("Dana Test", "rare disease", ["2"]);
    tracker.rememberAuthor("Dana-Test", { paperCount: 2 });
    tracker.rememberAuthorPapers("Other Person", "rare disease", ["2"]);
    // Act
    const authors = tracker.authorsOf("2");
    // Assert
    expect(tracker.authorsOf("1")).toHaveLength(1);
    expect(authors.map((a) => a.name).sort()).toEqual(["Dana Test", "Other Person"]);
    expect(authors.find((a) => a.name === "Dana Test")?.profile).toEqual({ paperCount: 2 });
    expect(authors.find((a) => a.name === "Other Person")?.profile).toBeUndefined();
    expect(tracker.authorProfile("dana test")).toEqual({ paperCount: 2 });
  });

  it("tracks NCT ids and verified NPIs", () => {
    const tracker = new ProvenanceTracker();
    expect(tracker.hasNctId("NCT00000001")).toBe(false);
    tracker.allowNctId("NCT00000001");
    tracker.allowVerifiedNpi("1234567893");
    expect(tracker.hasNctId("NCT00000001")).toBe(true);
    expect(tracker.hasVerifiedNpi("1234567893")).toBe(true);
    expect(tracker.hasVerifiedNpi("0000000000")).toBe(false);
  });
});

describe("finalizeOutput evidence filtering", () => {
  it("drops evidence from untracked URLs, disallowed source kinds and model-written contact points", () => {
    // Arrange
    const tracker = trackerWith("exa", { url: URL_A, text: "Alex Example practices pathology" });
    const dropped: string[] = [];
    const raw: ResearchOutput = {
      records: [expert("e1", [URL_A])],
      evidence: [
        ev("https://unknown.example/x", "Alex Example practices pathology"),
        ev(URL_A, "Alex Example practices pathology"),
      ],
    };
    // Act
    const none = finalizeOutput(raw, tracker, { allowedKinds: ["expert"], sourceKinds: ["nppes"] }, (_i, reason) => dropped.push(reason));
    const contact = finalizeOutput(
      { records: raw.records, evidence: [ev(URL_A, "x@example.org", { claimType: " Contact_Point.email.org_contact" })] },
      tracker,
      { allowedKinds: ["expert"] },
      (_i, reason) => dropped.push(reason),
    );
    // Assert
    expect(none.records).toEqual([]);
    expect(contact.records).toEqual([]);
    expect(dropped).toEqual([
      "no tool returned this sourceUrl",
      "source kind exa is not allowed for this agent",
      "contact points are stamped from tool output by code, never by a model",
    ]);
  });

  it("drops an ungrounded claim, using the default no-op onDrop when none is supplied", () => {
    // Arrange
    const tracker = trackerWith("exa", { url: URL_A, text: "Alex Example practices pathology" });
    // Act
    const out = finalizeOutput(
      { records: [expert("e1", [URL_A])], evidence: [ev(URL_A, "Alex Example won the Nobel prize for 2031 chemistry discoveries")] },
      tracker,
      { allowedKinds: ["expert"] },
    );
    // Assert
    expect(out).toEqual({ records: [], evidence: [] });
  });

  it("uses restated claims, and drops items whose restate returns null", () => {
    // Arrange
    const tracker = trackerWith("nppes", { url: URL_A });
    const dropped: string[] = [];
    const rules = {
      allowedKinds: ["expert"] as const,
      restateClaim: (item: { claim: string }) => (item.claim === "keep" ? "Rebuilt from tool record." : null),
    };
    // Act
    const out = finalizeOutput(
      { records: [expert("e1", [URL_A])], evidence: [ev(URL_A, "keep"), ev(URL_A, "drop")] },
      tracker,
      rules,
      (_i, reason) => dropped.push(reason),
    );
    // Assert
    expect(out.evidence.map((e) => e.claim)).toEqual(["Rebuilt from tool record."]);
    expect(dropped).toEqual(["claim could not be rebuilt from the tool record"]);
  });

  it("collapses duplicate claims and stamps source kind and fetch time from the tool", () => {
    // Arrange
    const tracker = trackerWith("nppes", { url: URL_A });
    const rules = { allowedKinds: ["expert"] as const, restateClaim: () => "Same restated claim." };
    // Act
    const out = finalizeOutput(
      { records: [expert("e1", [URL_A])], evidence: [ev(URL_A, "one"), ev(URL_A, "two")] },
      tracker,
      rules,
    );
    // Assert
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0]).toMatchObject({ sourceKind: "nppes", fetchedAt: "2026-01-02T03:04:05.000Z" });
  });

  it("keeps only the first evidence id when two items claim the same id, and resolves refs by id", () => {
    // Arrange
    const tracker = trackerWith("nppes", { url: URL_A });
    const rules = { allowedKinds: ["expert"] as const, restateClaim: (i: { claim: string }) => i.claim };
    // Act
    const out = finalizeOutput(
      {
        records: [expert("e1", ["dup"])],
        evidence: [ev(URL_A, "first claim", { id: "dup" }), ev(URL_A, "second claim", { id: "dup" })],
      },
      tracker,
      rules,
    );
    // Assert: only the first (id-bearing) claim is cited by the id ref.
    expect(out.evidence.map((e) => e.claim)).toEqual(["first claim"]);
    expect(out.evidence[0]?.id).toBe("dup");
  });

  it("omits evidence that no kept record references", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    tracker.collect("nppes", { a: URL_A, b: URL_B });
    const rules = { allowedKinds: ["expert"] as const, restateClaim: (i: { claim: string }) => i.claim };
    // Act
    const out = finalizeOutput(
      { records: [expert("e1", [URL_A])], evidence: [ev(URL_A, "cited"), ev(URL_B, "orphan")] },
      tracker,
      rules,
    );
    // Assert
    expect(out.evidence.map((e) => e.claim)).toEqual(["cited"]);
  });
});

describe("finalizeOutput records", () => {
  const rules = { allowedKinds: ["expert", "trial", "organization"] as const, restateClaim: (i: { claim: string }) => i.claim };

  it("skips disallowed kinds, duplicate ids, and records with no resolvable evidence", () => {
    // Arrange
    const tracker = trackerWith("nppes", { url: URL_A });
    const records: Resource[] = [
      { kind: "institution", id: "i1", name: "Hospital", evidenceRefs: [URL_A] } as Resource,
      expert("e1", [URL_A]),
      expert("e1", [URL_A]),
      expert("e2", ["https://nowhere.example/"]),
      expert("e3", []),
    ];
    // Act
    const out = finalizeOutput({ records, evidence: [ev(URL_A, "claim")] }, tracker, rules);
    // Assert
    expect(out.records.map((r) => r.id)).toEqual(["e1"]);
  });

  it("keeps only credentials a tool mentioned and only NPIs a tool verified, and strips model-written verified/profile", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    tracker.collect("nppes", { url: URL_A, credential: "MD", name: "Alex Example" });
    tracker.allowVerifiedNpi("1234567893");
    tracker.rememberAuthor("Alex Example", { paperCount: 4 });
    // Act
    const verified = finalizeOutput(
      { records: [expert("e1", [URL_A], { npi: "1234567893", credentials: "MD", verified: true, profile: { paperCount: 99 } })], evidence: [ev(URL_A, "c")] },
      tracker,
      rules,
    );
    const unverified = finalizeOutput(
      { records: [expert("e2", [URL_A], { npi: "9999999999", credentials: "FRCS", verified: true })], evidence: [ev(URL_A, "c")] },
      tracker,
      rules,
    );
    // Assert
    expect(verified.records[0]).toMatchObject({ npi: "1234567893", credentials: "MD", verified: true, profile: { paperCount: 4 } });
    expect(unverified.records[0]).toMatchObject({ npi: null });
    expect(unverified.records[0]).not.toHaveProperty("credentials");
    expect(unverified.records[0]).not.toHaveProperty("verified");
  });

  it("drops trial records whose NCT id no tool returned and attaches registry facts when known", () => {
    // Arrange
    const tracker = trackerWith("ctgov", { url: URL_A });
    const registry = { conditions: [], keywords: [], meshTerms: [], stdAges: [], phases: [], usSiteCount: 1, usRecruitingSiteCount: 1, recruitingSiteStates: ["AZ"], investigators: [], hasContact: true };
    tracker.rememberTrial("NCT00000001", registry);
    tracker.allowNctId("NCT00000002");
    const trial = (id: string, nctId: string) => ({ kind: "trial", id, nctId, title: "T", evidenceRefs: [URL_A], registry: { ...registry, usSiteCount: 77 } }) as Resource;
    // Act
    const out = finalizeOutput(
      { records: [trial("t1", "NCT00000001"), trial("t2", "NCT00000002"), trial("t3", "NCT00000003")], evidence: [ev(URL_A, "c")] },
      tracker,
      rules,
    );
    // Assert
    expect(out.records.map((r) => r.id)).toEqual(["t1", "t2"]);
    expect(out.records[0]).toMatchObject({ registry: { usSiteCount: 1 } });
    expect(out.records[1]).not.toHaveProperty("registry");
  });

  it("restricts organization kinds, and drops organization URLs no tool returned", () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    tracker.collect("exa", { url: URL_A, other: URL_B });
    const org = (id: string, extra: Record<string, unknown>) => ({ kind: "organization", id, name: "Org", evidenceRefs: [URL_A], ...extra }) as Resource;
    const orgRules = { ...rules, organizationKinds: ["advocacy"] as const };
    // Act
    const out = finalizeOutput(
      {
        records: [
          org("o1", { organizationKind: "advocacy", url: URL_B }),
          org("o2", { organizationKind: "advocacy", url: "https://invented.example/" }),
          org("o3", { organizationKind: "financial_aid" }),
          org("o4", {}),
        ],
        evidence: [ev(URL_A, "c")],
      },
      tracker,
      orgRules,
    );
    // Assert
    expect(out.records.map((r) => r.id)).toEqual(["o1", "o2"]);
    expect(out.records[0]).toMatchObject({ url: URL_B });
    expect(out.records[1]).not.toHaveProperty("url");
  });

  it("allows any organization kind when the rules do not restrict them", () => {
    const tracker = trackerWith("exa", { url: URL_A });
    const out = finalizeOutput(
      { records: [{ kind: "organization", id: "o1", name: "Org", evidenceRefs: [URL_A] } as Resource], evidence: [ev(URL_A, "c")] },
      tracker,
      rules,
    );
    expect(out.records).toHaveLength(1);
  });

  it("passes institution records through when allowed", () => {
    const tracker = trackerWith("exa", { url: URL_A });
    const out = finalizeOutput(
      { records: [{ kind: "institution", id: "i1", name: "Center", evidenceRefs: [URL_A] } as Resource], evidence: [ev(URL_A, "c")] },
      tracker,
      { allowedKinds: ["institution"], restateClaim: (i) => i.claim },
    );
    expect(out.records[0]).toMatchObject({ kind: "institution", id: "i1" });
  });

  it("appends code-stamped contact evidence for URLs backing a record and returns it once", () => {
    // Arrange
    const tracker = trackerWith("nppes", { url: NPPES_URL });
    tracker.rememberContactPoints([
      { channel: "voice", address: "+16176323000", origin: "nppes_location_phone", sourceUrl: NPPES_URL, sourceKind: "nppes" },
    ]);
    const raw = {
      records: [expert("e1", [NPPES_URL]), expert("e2", [NPPES_URL])],
      evidence: [ev(NPPES_URL, "c")],
    };
    // Act
    const out = finalizeOutput(raw, tracker, rules);
    // Assert
    const phone = out.evidence.filter((e) => e.claimType.startsWith("contact_point"));
    expect(phone).toHaveLength(1);
    expect(phone[0]?.claim).toBe("+16176323000");
    expect(out.records[0]?.evidenceRefs).toContain(phone[0]?.id);
  });

  it("ignores contact points that fail validation (malformed phone number)", () => {
    // Arrange
    const tracker = trackerWith("exa", { url: URL_A });
    tracker.rememberContactPoints([
      { channel: "voice", address: "+1234", origin: "nppes_location_phone", sourceUrl: URL_A, sourceKind: "nppes" },
    ]);
    // Act
    const out = finalizeOutput({ records: [expert("e1", [URL_A])], evidence: [ev(URL_A, "c")] }, tracker, rules);
    // Assert
    expect(out.evidence.some((e) => e.claimType.startsWith("contact_point"))).toBe(false);
  });
});

describe("trackedTool", () => {
  it("records every output in the tracker before returning it", async () => {
    // Arrange
    const tracker = new ProvenanceTracker(FIXED_NOW);
    const tool = trackedTool({
      name: "t",
      description: "d",
      inputSchema: z.object({ q: z.string() }),
      kind: "exa",
      tracker,
      run: async ({ q }) => ({ url: URL_A, q }),
    });
    // Act
    const out = await tool.handler({ q: "hello" } as never);
    // Assert
    expect(out).toEqual({ url: URL_A, q: "hello" });
    expect(tracker.sourceFor(URL_A)?.kind).toBe("exa");
  });
});

describe("caseSlug", () => {
  it.each([
    ["Epithelioid Sarcoma", "epithelioid-sarcoma"],
    ["Vascular Ehlers-Danlos", "vascular-eds"],
    ["IgG4-related disease", "igg4-related-disease"],
    ["  Some Rare--Disease! ", "some-rare-disease"],
  ])("maps %s to %s", (name, slug) => {
    expect(caseSlug({ diseaseName: name })).toBe(slug);
  });
});

describe("runResearch", () => {
  const ctx = () => ({ ports: createFixturePorts(), store: new MemoryRunStore(), caseId: "shared-branches" });
  const spec = (seed: Parameters<typeof runResearch>[0]["seed"]) => ({
    name: "trials" as const,
    instructions: "test",
    rules: { allowedKinds: ["expert" as const], restateClaim: (i: { claim: string }) => i.claim },
    makeTools: (_p: unknown, tracker: ProvenanceTracker) => [
      trackedTool({ name: "echo", description: "d", inputSchema: z.object({ q: z.string() }), kind: "exa", tracker, run: async ({ q }) => ({ url: URL_A, q }) }),
    ],
    seed,
  });

  it("returns an error result when the seed calls an unknown tool", async () => {
    // Act
    const result = await runResearch(spec(async (call) => call("missing", {})))({ diseaseName: "x", goals: [] }, ctx());
    // Assert
    expect(result).toEqual({ status: "error", message: "Unknown tool missing" });
  });

  it("returns an error result when seed input fails schema validation", async () => {
    const result = await runResearch(spec(async (call) => call("echo", { q: 5 })))({ diseaseName: "x", goals: [] }, ctx());
    expect(result.status).toBe("error");
  });

  it("stringifies non-Error throwables", async () => {
    const result = await runResearch(spec(async () => Promise.reject("plain string failure")))({ diseaseName: "x", goals: [] }, ctx());
    expect(result).toEqual({ status: "error", message: "plain string failure" });
  });

  it("truncates an oversized seed and finalizes the model output against tracked provenance", async () => {
    // Arrange
    runtime.override = () => ({
      records: [expert("e1", [URL_A])],
      evidence: [ev(URL_A, "model prose")],
    });
    const seed = async (call: (n: string, i: Record<string, unknown>) => Promise<unknown>) => {
      await call("echo", { q: "hi" });
      return "x".repeat(50_000);
    };
    // Act
    const result = await runResearch(spec(seed))({ diseaseName: "x", goals: [] }, ctx());
    // Assert
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.records.map((r) => r.id)).toEqual(["e1"]);
    expect(result.evidence[0]?.claim).toBe("model prose");
  });
});

describe("notImplemented", () => {
  it("builds an agent that reports not_implemented", async () => {
    const agent = notImplemented("network");
    expect(agent.name).toBe("network");
    expect(await agent.run()).toEqual({ status: "not_implemented" });
  });
});
