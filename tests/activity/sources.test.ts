import { describe, expect, it } from "vitest";
import { maskDestination } from "@/lib/activity/mask";
import { agentRunEventsForTest } from "./helpers";
import { contactEvents, contactLanes, destinationLabel } from "@/lib/activity/sources/contacts";
import { applicationEvents, applicationLanes, type AppRow } from "@/lib/activity/sources/web-applications";
import { agentDecisionEvents } from "@/lib/activity/sources/agent-events";
import { countdownLabel } from "@/components/live/format";

describe("maskDestination", () => {
  it("shows only a domain or the last 4 digits", () => {
    expect(maskDestination("Jane.Doe@Clinic.Example.org", "email")).toBe("clinic.example.org");
    expect(maskDestination("+1 (216) 555-0142", "voice")).toBe("Phone ending 0142");
    expect(maskDestination("https://apply.example.org/path?token=abc", "web")).toBe("apply.example.org");
    expect(maskDestination("", "email")).toBe("Email");
    expect(maskDestination("jane@clinic.org", "email")).not.toContain("jane");
  });

  it("labels shared demo destinations", () => {
    expect(destinationLabel("demo@agentmail.to", "email", ["Demo@agentmail.to"])).toBe("Test inbox (safe mode)");
    expect(destinationLabel("real@clinic.org", "email", ["demo@example.test"])).toBe("clinic.org");
  });
});

describe("contact events", () => {
  const views = [{ id: "k1", targetKind: "institution" as const, targetId: "t", displayName: "Mercy Clinic", channel: "email" as const, state: "sent", nextFollowUpAt: "2026-02-01T00:00:00.000Z", lastActivityAt: "2026-01-02T00:00:00.000Z", consented: true, approved: true }];
  const threads = [{ contactId: "k1", label: "Mercy Clinic", messages: [
    { id: "m1", direction: "outbound" as const, channel: "email" as const, subject: "Hello", body: "b", sharedFields: [], at: "2026-01-01T00:00:00.000Z", classification: null },
    { id: "m2", direction: "inbound" as const, channel: "email" as const, subject: null, body: "<script>x</script> Reply", sharedFields: [], at: "2026-01-02T00:00:00.000Z", classification: "referral" },
    { id: "m3", direction: "outbound" as const, channel: "voice" as const, subject: null, body: "AI: x", sharedFields: [], at: "2026-01-03T00:00:00.000Z", classification: null },
  ] }];

  it("produces deterministic ids and skips voice thread entries", () => {
    const events = contactEvents(views, threads, [{ id: "tk", contactId: "k1", kind: "referral", title: "Get referral", status: "open", dueAt: null }]);
    expect(events.map((e) => e.id).sort()).toEqual(["fu:k1:2026-02-01T00:00:00.000Z", "msg:m1:sent", "msg:m2:reply", "task:tk:created"]);
    expect(events.find((e) => e.id === "msg:m2:reply")?.detail).toContain("<script>"); // kept as text; the UI renders text only
  });

  it("builds lanes without exposing the address", () => {
    const lanes = contactLanes(views, new Map([["k1", { id: "k1", address: "intake@mercy.org", firstSentAt: null, followUpsSent: 0 }]]), []);
    expect(JSON.stringify(lanes)).not.toContain("intake@");
    expect(lanes[0]).toMatchObject({ destinationLabel: "mercy.org", targetKind: "institution", resourceName: "Mercy Clinic" });
  });
});

describe("web applications", () => {
  const app: AppRow = { id: "a1", contactId: "k1", url: "https://apply.example.org/form", status: "submitted", fieldCount: 6, missingCount: 0, hasScreenshot: true, createdAt: new Date("2026-01-01T00:00:00Z"), approvedAt: new Date("2026-01-01T00:05:00Z"), submittedAt: new Date("2026-01-01T00:06:00Z"), result: { reason: "submitted" } };
  it("emits steps with a screenshot route instead of embedding the image", () => {
    const events = applicationEvents("case-1", [app]);
    expect(events.map((e) => e.kind)).toEqual(["browser_step", "application_filled", "browser_step", "application_submitted"]);
    expect(events[1].imageUrl).toBe("/api/cases/case-1/activity/screenshot/a1");
    expect(applicationLanes("case-1", [app])[0]).toMatchObject({ channel: "web", application: { status: "submitted", confirmation: "Submitted" } });
  });
});

describe("agent decisions and agent runs", () => {
  it("maps factory agent_events rows", () => {
    const events = agentDecisionEvents([{ id: "e1", contact_id: "k1", agent_name: "Mercy agent", kind: "decision", trigger: "cron", reason: "No reply in 5 days", action: "follow_up", result: null, created_at: new Date("2026-01-01T00:00:00Z") }]);
    expect(events[0]).toMatchObject({ id: "agentev:e1", kind: "agent_decision", contactId: "k1", title: "Mercy agent scheduled a follow-up" });
  });

  it("maps agent_runs rows", () => {
    const events = agentRunEventsForTest();
    expect(events.map((e) => e.id)).toEqual(["run:r1:started", "run:r1:finished", "run:r2:started", "run:r2:failed"]);
  });
});

describe("countdownLabel", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  it("formats days/hours/minutes/seconds and due-now", () => {
    expect(countdownLabel("2026-01-03T04:03:12Z", now)).toBe("Follow-up in 2d 4h 03m 12s");
    expect(countdownLabel("2026-01-01T00:12:03Z", now)).toBe("Follow-up in 12m 03s");
    expect(countdownLabel("2025-12-31T00:00:00Z", now)).toBe("Follow-up due now");
    expect(countdownLabel(null, now)).toBeNull();
  });
});
