import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentCardMotion } from "@/components/motion/AgentCardMotion";
import { EvidenceReveal } from "@/components/motion/EvidenceReveal";
import { ScoreBar } from "@/components/motion/ScoreBar";
import { StaggerList } from "@/components/motion/StaggerList";
import { SwarmConstellation } from "@/components/motion/swarm/SwarmConstellation";
import { MotionPreference } from "@/lib/motion/MotionPreference";
import { initialSwarm } from "@/lib/motion/simulate";

/**
 * Server-renders components with reduced motion forced on (no DOM, no
 * testing-library) and checks the markup is the final state: nothing hidden
 * at opacity 0, no translate offsets, no scaleX(0) bars.
 */
function renderReduced(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MotionPreference, { reducedMotion: true }, element));
}

function renderAnimated(element: ReactElement): string {
  return renderToStaticMarkup(createElement(MotionPreference, { reducedMotion: false }, element));
}

const HIDDEN = /opacity:\s*0[;"]/;

describe("reduced motion renders the final state", () => {
  it("StaggerList items are visible in place", () => {
    const element = createElement(StaggerList<string>, {
      items: ["a", "b"],
      getKey: (s: string) => s,
      renderItem: (s: string) => s,
    });
    const reduced = renderReduced(element);
    expect(reduced).not.toMatch(HIDDEN);
    expect(reduced).not.toMatch(/translateY/);
    // Sanity: the animated path really does start hidden, so the test above means something.
    expect(renderAnimated(element)).toMatch(HIDDEN);
  });

  it("ScoreBar segments render at full scale", () => {
    const element = createElement(ScoreBar, {
      items: [
        { factor: "a", points: 3, text: "A", evidenceIds: [] },
        { factor: "b", points: 1, text: "B", evidenceIds: ["x"] },
      ],
    });
    const reduced = renderReduced(element);
    expect(reduced).not.toMatch(/scaleX\(0\)/);
    expect(reduced).toContain("1 source");
    expect(renderAnimated(element)).toMatch(/scaleX\(0\)/);
  });

  it("AgentCardMotion shows its status without an entrance offset", () => {
    const html = renderReduced(createElement(AgentCardMotion, { name: "trials", status: "running" }));
    expect(html).toContain("Searching");
    expect(html).not.toMatch(HIDDEN);
  });

  it("EvidenceReveal starts open when asked, with the panel visible", () => {
    const html = renderReduced(
      createElement(EvidenceReveal, {
        defaultOpen: true,
        evidence: [
          {
            claimType: "status",
            claim: "Recruiting",
            sourceUrl: "https://clinicaltrials.gov/",
            sourceKind: "ctgov",
            fetchedAt: "2026-10-20T15:04:00.000Z",
          },
        ],
      }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/inset\(0% 0% 100% 0%\)/);
  });

  it("SwarmConstellation renders the text-equivalent list and a live region", () => {
    const agents = initialSwarm().map((a, i) =>
      i === 0 ? { ...a, status: "done" as const, counts: { papers: 3 } } : a,
    );
    const html = renderReduced(createElement(SwarmConstellation, { agents }));
    expect(html).toContain('data-reduced="true"');
    expect(html).toContain("Published research");
    expect(html).toContain("3 papers");
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/<li /g)).toHaveLength(12);
  });
});
