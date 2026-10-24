import { describe, expect, it } from "vitest";
import { SEARCH_COPY } from "@/components/patient/views/search/copy";
import { foundCount, searchPhase, searchRows, sourceTotal } from "@/components/patient/views/search/model";
import type { PatientStatus, PatientTimelineItem } from "@/lib/patient-status/types";

const base: PatientStatus = { headline: "", step: "search", tone: "working", updatedAt: "2026-10-24T00:00:00Z" };
const status = (over: Partial<PatientStatus>): PatientStatus => ({ ...base, ...over });

describe("searchPhase", () => {
  it("is searching while the step is search", () => {
    expect(searchPhase(status({}))).toBe("searching");
  });
  it("is done when the next action is to pick contacts", () => {
    expect(searchPhase(status({ step: "choose", tone: "you", nextAction: { kind: "pick_contacts", label: "x", detailsHref: "/" } }))).toBe("done");
  });
  it("is failed when the search can be retried", () => {
    expect(searchPhase(status({ tone: "problem", nextAction: { kind: "retry_search", label: "x", detailsHref: "/" } }))).toBe("failed");
  });
  it("is done once past the search step", () => {
    expect(searchPhase(status({ step: "reach", tone: "waiting" }))).toBe("done");
  });
  it("is none when nothing was found", () => {
    expect(searchPhase(status({ step: "choose", tone: "problem" }))).toBe("none");
  });
  it("is not started before the details are confirmed", () => {
    expect(searchPhase(status({ step: "tell", tone: "you" }))).toBe("not_started");
  });
});

describe("foundCount and sourceTotal", () => {
  it("reads the count from the timeline first", () => {
    const timeline: PatientTimelineItem[] = [{ id: "search-done", text: "Searched 9 public sources and found 16 people and programs", at: null }];
    expect(foundCount(status({ headline: "Found 3 people" }), timeline)).toBe(16);
  });
  it("falls back to the headline, then null", () => {
    expect(foundCount(status({ headline: "Found 4 people and programs who can help." }), [])).toBe(4);
    expect(foundCount(status({ headline: "Your results are ready." }), [])).toBeNull();
  });
  it("uses the progress total, else 9", () => {
    expect(sourceTotal(status({ progress: { done: 1, total: 7 } }))).toBe(7);
    expect(sourceTotal(status({}))).toBe(9);
  });
});

describe("searchRows", () => {
  it("shows what is being read now and at most three rows", () => {
    const timeline: PatientTimelineItem[] = [
      { id: "search-start", text: "Started looking for you", at: null },
      { id: "search-done", text: "Searched 9 public sources", at: null },
      { id: "x1", text: "extra", at: null },
    ];
    const rows = searchRows(status({ detail: "Right now: ClinicalTrials.gov." }), timeline, "searching");
    expect(rows[0]).toBe("Now reading ClinicalTrials.gov");
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

describe("copy", () => {
  it("has the spec headings and no banned words", () => {
    expect(SEARCH_COPY.titleSearching(9)).toBe("We're looking in 9 places");
    expect(SEARCH_COPY.titleDone(16)).toBe("We found 16 who may help");
    expect(SEARCH_COPY.progressName(6, 9)).toBe("6 of 9 done");
    const text = JSON.stringify([SEARCH_COPY.lede, SEARCH_COPY.rowWorking, SEARCH_COPY.failedBody]).toLowerCase();
    for (const word of ["agent", "swarm", "curator", "verifier", "allowlist", "resource", "score", "rank", "tier", "pipeline"]) {
      expect(text).not.toContain(word);
    }
  });
});
