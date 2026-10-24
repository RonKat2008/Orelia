import { describe, expect, it } from "vitest";
import { patientTimeline } from "@/lib/patient-status/timeline";
import type { PatientCaseSnapshot } from "@/lib/patient-status/types";

const base: PatientCaseSnapshot = {
  caseId: "11111111-1111-4111-8111-111111111111",
  found: true,
  caseStatus: "ready",
  diseaseName: "vEDS",
  runs: [],
  expectedSources: 9,
  shortlist: null,
  contacts: [],
  tasks: [],
  applications: [],
  plan: null,
};

describe("patientTimeline", () => {
  it("is empty for an empty case", () => {
    expect(patientTimeline(base)).toEqual([]);
  });

  it("does not claim the search finished while it is running", () => {
    const items = patientTimeline({ ...base, runs: [{ agent: "trials", status: "running", startedAt: "2026-10-24T10:00:00.000Z" }] });
    expect(items.map((i) => i.text)).toEqual(["Started looking for you"]);
  });

  it("lists what happened, newest first, in plain words", () => {
    const items = patientTimeline({
      ...base,
      runs: [
        { agent: "trials", status: "done", startedAt: "2026-10-20T10:00:00.000Z", finishedAt: "2026-10-20T10:05:00.000Z" },
        { agent: "centers", status: "failed", startedAt: "2026-10-20T10:00:00.000Z", finishedAt: "2026-10-20T10:06:00.000Z" },
      ],
      shortlist: { total: 7, suggested: 2 },
      contacts: [
        { id: "c1", name: "Stanford Health Care", channel: "email", state: "task_open", consented: true, approved: true, nextFollowUpAt: null, lastActivityAt: "2026-10-23T09:00:00.000Z", firstSentAt: "2026-10-22T09:00:00.000Z", lastReplyAt: "2026-10-23T09:00:00.000Z" },
        { id: "c2", name: "FIGHT vEDS", channel: "voice", state: "stalled", consented: true, approved: true, nextFollowUpAt: null, lastActivityAt: "2026-10-24T09:00:00.000Z", firstSentAt: "2026-10-21T09:00:00.000Z" },
        { id: "c3", name: "Cleveland Clinic", channel: "email", state: "sent", consented: true, approved: true, nextFollowUpAt: null, lastActivityAt: null },
      ],
      tasks: [{ id: "t1", contactId: "c1", kind: "records", title: "Send records", status: "open", dueAt: null }],
      applications: [{ id: "a1", contactId: "c3", status: "submitted", submittedAt: "2026-10-22T12:00:00.000Z" }],
    });
    expect(items.map((i) => i.text)).toEqual([
      "FIGHT vEDS hasn't replied after two follow-ups",
      "Stanford Health Care replied: they need your records",
      "Sent your online form to Cleveland Clinic",
      "Emailed Stanford Health Care",
      "Called FIGHT vEDS",
      "Searched 2 public sources and found 7 people and programs",
    ]);
    expect(items[0]!.at).toBe("2026-10-24T09:00:00.000Z");
  });

  it("caps the list", () => {
    const contacts = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`, name: `Clinic ${i}`, channel: "email" as const, state: "sent", consented: true, approved: true,
      nextFollowUpAt: null, lastActivityAt: null, firstSentAt: `2026-10-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`,
    }));
    expect(patientTimeline({ ...base, contacts }, { limit: 4 })).toHaveLength(4);
  });
});
