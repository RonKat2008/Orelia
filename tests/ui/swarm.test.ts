import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SwarmConstellation } from "@/components/motion/swarm/SwarmConstellation";
import { MotionPreference } from "@/lib/motion/MotionPreference";
import {
  connectionBadge,
  derivePhase,
  describeProgress,
  initialAgents,
  narrate,
  parseRunsSnapshot,
  sourcesFromShortlist,
  swarmTotals,
} from "@/components/swarm/stream";
import { mockSwarmScript } from "@/components/swarm/preview";

const runs = (rows: unknown[], caseStatus = "researching") => JSON.stringify({ caseId: "x", caseStatus, runs: rows });

describe("parseRunsSnapshot", () => {
  it("keeps agents without a row queued and applies the rest", () => {
    const snap = parseRunsSnapshot(
      runs([{ agent: "literature", status: "running", counts: null, error: null, outputSummary: null }]),
    );
    expect(snap?.cards.find((c) => c.agent === "literature")?.status).toBe("running");
    expect(snap?.cards.find((c) => c.agent === "trials")?.status).toBe("queued");
    expect(snap?.caseStatus).toBe("researching");
  });

  it("rejects malformed data", () => {
    expect(parseRunsSnapshot("not json")).toBeNull();
    expect(parseRunsSnapshot(JSON.stringify({ runs: [{ agent: "a", status: "nope" }] }))).toBeNull();
  });
});

describe("phases, narrative and totals", () => {
  const settled = (parseRunsSnapshot(
    runs(initialAgents().map((c) => ({ agent: c.agent, status: "done", counts: { records: 2, evidence: 3 } }))),
  ) ?? { cards: [] }).cards;

  it("moves from search to verify to complete", () => {
    expect(derivePhase(initialAgents())).toBe(0);
    expect(derivePhase(settled, "researching")).toBe(1);
    expect(derivePhase(settled, "ready")).toBe(4);
  });

  it("sums counts", () => {
    expect(swarmTotals(settled)).toMatchObject({ settled: 9, total: 9, records: 18, evidence: 27 });
  });

  it("narrates what is happening without medical language", () => {
    const running = initialAgents().map((c) => (c.agent === "literature" ? { ...c, status: "running" as const } : c));
    expect(narrate(running, "researching", "literature")).toContain("PubMed");
    expect(narrate(settled, "ready")).toMatch(/^Done\./);
  });
});

describe("describeProgress", () => {
  it("announces only when an agent settles", () => {
    const before = initialAgents();
    const running = before.map((c) => (c.agent === "trials" ? { ...c, status: "running" as const } : c));
    const done = before.map((c) => (c.agent === "trials" ? { ...c, status: "done" as const } : c));
    expect(describeProgress(before, running)).toBeNull();
    expect(describeProgress(running, done)).toContain("1 of 9");
  });
});

describe("sourcesFromShortlist", () => {
  it("dedupes urls and maps known source kinds to agents", () => {
    const json = {
      groups: {
        expert: [
          {
            evidence: [
              { sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/1", sourceKind: "pubmed", claim: "a" },
              { sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/1", sourceKind: "pubmed", claim: "a" },
              { sourceUrl: "https://example.org/x", sourceKind: "exa", claim: "b" },
            ],
          },
        ],
      },
    };
    const out = sourcesFromShortlist(json);
    expect(out).toHaveLength(2);
    expect(out[0].agent).toBe("literature");
    expect(out[1].agent).toBeNull();
    expect(sourcesFromShortlist({ nope: 1 })).toEqual([]);
  });
});

describe("preview script and constellation", () => {
  it("covers all nine agents", () => {
    expect(new Set(mockSwarmScript().map((e) => e.agent)).size).toBe(9);
  });

  it("renders the map without the legend for the swarm page", () => {
    const html = renderToStaticMarkup(
      createElement(MotionPreference, { reducedMotion: true }, createElement(SwarmConstellation, {
        agents: initialAgents().map((c) => ({ name: c.agent, status: c.status })),
        showLegend: false,
        announce: false,
      })),
    );
    expect(html).toContain('data-reduced="true"');
    expect(html).not.toContain("<li ");
    expect(html).not.toContain("aria-live");
  });
});

describe("connectionBadge", () => {
  it("shows live updates only while the run is going", () => {
    expect(connectionBadge("live", "researching")).toMatchObject({ label: "Live updates", dot: true });
    expect(connectionBadge("live")).toMatchObject({ label: "Live updates" });
  });

  it("settles to a finished state once the stream reports the run complete", () => {
    expect(connectionBadge("live", "ready")).toEqual({ tone: "ok", label: "Run finished", dot: false });
    expect(connectionBadge("live", "research_failed")).toMatchObject({ label: "Run stopped", dot: false });
  });

  it("falls back to connecting before the stream opens", () => {
    expect(connectionBadge("connecting")).toMatchObject({ label: "Connecting…" });
  });
});
