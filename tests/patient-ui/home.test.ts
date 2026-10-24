import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PATIENT_HOME_COPY } from "@/components/patient/copy";
import { CONSENT_COPY } from "@/components/patient/flows/consent/copy";
import { PLAN_COPY } from "@/components/patient/flows/plan/copy";
import { SHORTLIST_COPY } from "@/components/patient/flows/shortlist/copy";
import { latestHappened, statusBadgeTone, stepText } from "@/components/patient/home-logic";
import { PatientSteps } from "@/components/patient/PatientSteps";
import { WhatsHappened } from "@/components/patient/WhatsHappened";
import { ActionFrame } from "@/components/patient/actions/ActionFrame";

const BANNED = ["agent", "swarm", "curator", "verifier", "allowlist", "resource", "score", "rank", "tier", "pipeline"];

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    try {
      const out = (value as (...args: unknown[]) => unknown)("X", 2, 3);
      return typeof out === "string" ? [out] : [];
    } catch {
      return [];
    }
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("patient copy", () => {
  const all = [PATIENT_HOME_COPY, CONSENT_COPY, PLAN_COPY, SHORTLIST_COPY].flatMap(strings);
  it("uses no banned words and never says Not on file", () => {
    for (const text of all) {
      for (const word of BANNED) expect(text.toLowerCase(), text).not.toMatch(new RegExp(`\\b${word}`));
      expect(text).not.toContain("Not on file");
    }
  });

  it("keeps sentences to 20 words or fewer", () => {
    for (const text of all) {
      for (const sentence of text.split(/[.!?]\s/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
    }
  });

  it("states the AI disclosure once, by the save button", () => {
    expect(CONSENT_COPY.reassurance).toBe("Only what you say yes to is shared. Every message says an AI helped write it.");
  });
});

describe("home logic", () => {
  it("shows the 3 latest items and says when there are more", () => {
    const items = [1, 2, 3, 4].map((n) => ({ id: String(n), text: `Item ${n}`, at: null }));
    expect(latestHappened(items)).toEqual({ shown: items.slice(0, 3), more: true });
    expect(latestHappened(items.slice(0, 2)).more).toBe(false);
  });

  it("writes the step line and picks patient badge tones", () => {
    expect(stepText("choose")).toBe("Step 3 of 4 · You choose");
    expect(statusBadgeTone("you")).toBe("teal");
    expect(statusBadgeTone("good")).toBe("ok");
    expect(statusBadgeTone("problem")).toBe("warn");
  });
});

describe("home markup", () => {
  it("renders the 4-segment line with the current step", () => {
    const html = renderToStaticMarkup(createElement(PatientSteps, { current: "choose" }));
    expect(html).toContain("Step 3 of 4 · You choose");
    expect(html.match(/<li/g)).toHaveLength(4);
    expect(html).toContain('aria-current="step"');
  });

  it("links See all only when there are more than 3 items", () => {
    const items = [1, 2, 3, 4].map((n) => ({ id: String(n), text: `Item ${n}`, at: null }));
    const html = renderToStaticMarkup(createElement(WhatsHappened, { items, seeAllHref: "/cases/x/tracker" }));
    expect(html).toContain('href="/cases/x/tracker"');
    expect(html).not.toContain("Item 4");
    const few = renderToStaticMarkup(createElement(WhatsHappened, { items: items.slice(0, 3), seeAllHref: "/cases/x/tracker" }));
    expect(few).not.toContain("/cases/x/tracker");
  });

  it("keeps the ActionFrame test hooks on the ActionCard and shows a quiet See details link", () => {
    const html = renderToStaticMarkup(
      createElement(ActionFrame, { kind: "approve_message", title: "Message to X", detailsHref: "/cases/x/outbox" }, "body"),
    );
    expect(html).toContain('data-testid="patient-action"');
    expect(html).toContain('data-action="approve_message"');
    expect(html).toContain('data-slot="action-card"');
    expect(html).toContain('href="/cases/x/outbox"');
    expect(html).toContain(PATIENT_HOME_COPY.seeDetails);
  });
});
