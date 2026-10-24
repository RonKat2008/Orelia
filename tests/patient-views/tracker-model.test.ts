import { describe, expect, it } from "vitest";
import type { ApiContact } from "@/components/outreach/client";
import type { OutreachTask } from "@/components/outreach/types";
import { TRACKER_COPY } from "@/components/patient/views/tracker/copy";
import { detailLines, followUpLine, needsYouIds, orderContacts, shortDay, statusWord, trackerPrimary } from "@/components/patient/views/tracker/model";
import type { NextActionKind, PatientStatus } from "@/lib/patient-status/types";

const contact = (over: Partial<ApiContact> = {}): ApiContact => ({
  id: "c1",
  caseId: "k",
  targetId: "t",
  targetKind: "resource",
  channel: "email",
  address: "a@b.org",
  state: "sent",
  displayName: "Stanford Clinic",
  nextFollowUpAt: null,
  ...over,
});
const task = (over: Partial<OutreachTask> = {}): OutreachTask => ({
  id: "t1",
  contactId: "c1",
  contactName: "Stanford Clinic",
  kind: "records",
  summary: "They need your records",
  status: "open",
  dueAt: null,
  ...over,
});

describe("shortDay and followUpLine", () => {
  it("words the exact day", () => {
    expect(shortDay("2026-10-27T15:00:00Z", "UTC")).toBe("Tue 27 Oct");
    expect(followUpLine(contact({ nextFollowUpAt: "2026-10-27T15:00:00Z" }), "UTC")).toBe("We'll follow up on Tue 27 Oct");
  });
  it("is null with no date, a bad date, or a finished contact", () => {
    expect(shortDay(null)).toBeNull();
    expect(shortDay("nope")).toBeNull();
    expect(followUpLine(contact({ state: "declined", nextFollowUpAt: "2026-10-27T15:00:00Z" }), "UTC")).toBeNull();
  });
});

describe("statusWord", () => {
  it("uses plain words, never state names", () => {
    expect(statusWord(contact({ state: "sent" }), false)).toBe("sent");
    expect(statusWord(contact({ state: "sent", nextFollowUpAt: "2026-10-27T00:00:00Z" }), false)).toBe("noReply");
    expect(statusWord(contact({ state: "replied" }), false)).toBe("replied");
    expect(statusWord(contact({ state: "task_open" }), true)).toBe("needsYou");
    expect(statusWord(contact({ state: "declined" }), false)).toBe("cantHelp");
    expect(statusWord(contact({ state: "appointment_booked" }), false)).toBe("booked");
    expect(statusWord(contact({ state: "stalled" }), false)).toBe("noReply");
    expect(statusWord(contact({ state: "drafted" }), false)).toBe("notSent");
    expect(Object.values(TRACKER_COPY.words).join(" ")).not.toMatch(/task_open|stalled|declined|drafted/);
  });
});

describe("needsYouIds and primary", () => {
  const status = (kind: NextActionKind): PatientStatus => ({
    headline: "h",
    step: "reach",
    tone: "you",
    updatedAt: "",
    nextAction: { kind, label: "Send my records", contactId: "c2", detailsHref: "/" },
  });
  it("collects open tasks, awaiting follow-ups and the status's own contact", () => {
    const ids = needsYouIds([contact({ id: "c3", followUpAwaitingApproval: true })], [task(), task({ id: "t2", contactId: "c9", status: "done" })], status("answer_task"));
    expect([...ids].sort()).toEqual(["c1", "c2", "c3"]);
  });
  it("has a primary only for things the patient must do", () => {
    expect(trackerPrimary(status("answer_task"))).toEqual({ label: "Send my records", contactId: "c2" });
    expect(trackerPrimary(status("try_someone_else"))).toBeNull();
    expect(trackerPrimary(null)).toBeNull();
  });
  it("puts needs-you contacts first without mutating the input", () => {
    const input = [contact({ id: "a" }), contact({ id: "b" })];
    expect(orderContacts(input, new Set(["b"])).map((c) => c.id)).toEqual(["b", "a"]);
    expect(input.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("detailLines", () => {
  it("shows how we reached them, the last message and the follow-up", () => {
    const lines = detailLines(contact({ nextFollowUpAt: "2026-10-27T15:00:00Z" }), [task()], "UTC");
    expect(lines).toEqual(["We emailed them", "Last message: They need your records", "We'll follow up on Tue 27 Oct"]);
  });
  it("says so when there is nothing to show", () => {
    expect(detailLines(contact({ state: "sent" }), [], "UTC")).toEqual(["We emailed them", "No reply to show yet", "No follow-up planned"]);
  });
});
