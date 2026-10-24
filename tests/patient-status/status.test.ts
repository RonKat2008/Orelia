import { describe, expect, it } from "vitest";
import { flagMedicalAdvice } from "@/lib/safety";
import { patientStatus, statusKey } from "@/lib/patient-status/status";
import type { PatientCaseSnapshot, PatientContact, PatientRun, PatientStatus } from "@/lib/patient-status/types";

const NOW = new Date("2026-10-24T15:00:00.000Z"); // a Saturday
const ID = "11111111-1111-4111-8111-111111111111";
const AGENTS = ["literature", "trials", "identity", "centers", "advocacy", "aid", "contact_finder", "network", "logistics"];

function snapshot(patch: Partial<PatientCaseSnapshot> = {}): PatientCaseSnapshot {
  return {
    caseId: ID,
    found: true,
    caseStatus: "ready",
    diseaseName: "vascular Ehlers-Danlos syndrome",
    runs: AGENTS.map((agent) => ({ agent, status: "done", finishedAt: "2026-10-24T14:00:00.000Z" })),
    expectedSources: 9,
    shortlist: { total: 12, suggested: 3 },
    contacts: [],
    tasks: [],
    applications: [],
    plan: null,
    ...patch,
  };
}

function contact(patch: Partial<PatientContact> = {}): PatientContact {
  return {
    id: "c1",
    name: "Stanford Health Care",
    channel: "email",
    state: "drafted",
    consented: true,
    approved: false,
    nextFollowUpAt: null,
    lastActivityAt: null,
    ...patch,
  };
}

function runs(done: number, running: string | null = "centers"): PatientRun[] {
  return AGENTS.map((agent, index) => ({
    agent,
    status: index < done ? "done" : agent === running ? "running" : "queued",
  }));
}

const status = (s: PatientCaseSnapshot, tz = "America/Los_Angeles"): PatientStatus => patientStatus(s, { now: NOW, timeZone: tz });

describe("patientStatus: case and intake", () => {
  it("handles a missing case", () => {
    const result = status(snapshot({ found: false, caseStatus: null }));
    expect(result.headline).toMatch(/couldn't find this case/i);
    expect(result.tone).toBe("problem");
    expect(result.nextAction).toBeUndefined();
  });

  it("asks an unconfirmed case to check its details", () => {
    for (const caseStatus of ["draft", "extracted", "unconfirmed"]) {
      const result = status(snapshot({ caseStatus, runs: [], shortlist: null }));
      expect(result.step).toBe("tell");
      expect(result.tone).toBe("you");
      expect(result.nextAction?.kind).toBe("confirm_details");
    }
  });

  it("treats an empty case (no status, nothing else) as not started", () => {
    const result = status(snapshot({ caseStatus: null, diseaseName: null, runs: [], shortlist: null }));
    expect(result.step).toBe("tell");
    expect(result.nextAction?.kind).toBe("confirm_details");
    expect(result.updatedAt).toBe(NOW.toISOString());
  });
});

describe("patientStatus: searching", () => {
  it("counts sources and names the one running", () => {
    const result = status(snapshot({ caseStatus: "researching", runs: runs(4, "advocacy"), shortlist: null }));
    expect(result.step).toBe("search");
    expect(result.tone).toBe("working");
    expect(result.headline).toBe(
      "Looking through 9 public sources for specialists who see adults with vascular Ehlers-Danlos syndrome… (4 of 9 done)",
    );
    expect(result.detail).toMatch(/patient advocacy groups/i);
    expect(result.progress).toEqual({ done: 4, total: 9 });
    expect(result.nextAction).toBeUndefined();
  });

  it("starts at 0 of 9 before any run row exists", () => {
    const result = status(snapshot({ caseStatus: "confirmed", runs: [], shortlist: null }));
    expect(result.step).toBe("search");
    expect(result.progress).toEqual({ done: 0, total: 9 });
    expect(result.headline).toContain("(0 of 9 done)");
  });

  it("counts failed and skipped sources as finished, not as found", () => {
    const mixed = runs(9, null).map((run, i) => (i === 0 ? { ...run, status: "failed" as const } : i === 1 ? { ...run, status: "not_implemented" as const } : run));
    const result = status(snapshot({ caseStatus: "researching", runs: mixed, shortlist: null }));
    expect(result.progress).toEqual({ done: 9, total: 9 });
    expect(result.headline).toMatch(/putting your list together/i);
  });

  it("ignores the pipeline's own phase rows when counting sources", () => {
    const withPhases: PatientRun[] = [
      ...runs(4, "advocacy"),
      { agent: "research", status: "running" },
      { agent: "verifier", status: "queued" },
    ];
    const result = status(snapshot({ caseStatus: "researching", runs: withPhases, shortlist: null }));
    expect(result.progress).toEqual({ done: 4, total: 9 });
    expect(result.headline).toContain("(4 of 9 done)");
  });

  it.each([
    ["verifier", /checking every name/i],
    ["ranker", /sorting/i],
    ["curator", /picking a few/i],
    ["judge", /against what you need/i],
  ])("words the %s phase once every source is read", (agent, pattern) => {
    const all: PatientRun[] = [...runs(9, null), { agent, status: "running" }];
    const result = status(snapshot({ caseStatus: "researching", runs: all, shortlist: null }));
    expect(result.headline).toMatch(pattern);
    expect(result.progress).toEqual({ done: 9, total: 9 });
  });

  it("falls back to a generic phrase when the disease name is unknown", () => {
    const result = status(snapshot({ caseStatus: "researching", diseaseName: null, runs: runs(1), shortlist: null }));
    expect(result.headline).toContain("adults with your condition");
  });

  it("offers a retry when research failed with nothing found", () => {
    const result = status(snapshot({ caseStatus: "research_failed", shortlist: { total: 0, suggested: 0 } }));
    expect(result.tone).toBe("problem");
    expect(result.step).toBe("search");
    expect(result.nextAction?.kind).toBe("retry_search");
    expect(result.headline).toMatch(/problem/i);
    expect(result.detail).toMatch(/nothing was sent/i);
  });

  it("still lets the patient choose when research failed part-way but found people", () => {
    const result = status(snapshot({ caseStatus: "research_failed", shortlist: { total: 4, suggested: 2 } }));
    expect(result.step).toBe("choose");
    expect(result.nextAction?.kind).toBe("pick_contacts");
    expect(result.detail).toMatch(/didn't finish/i);
  });
});

describe("patientStatus: choosing", () => {
  it("announces results and asks for up to five picks", () => {
    const result = status(snapshot());
    expect(result.step).toBe("choose");
    expect(result.tone).toBe("you");
    expect(result.headline).toBe("Found 12 people and programs who can help. Pick up to 5 to contact.");
    expect(result.nextAction).toMatchObject({ kind: "pick_contacts", detailsHref: `/cases/${ID}/shortlist` });
  });

  it("uses the singular for one result", () => {
    expect(status(snapshot({ shortlist: { total: 1, suggested: 1 } })).headline).toBe(
      "Found 1 person or program who can help. Pick them to get in touch.",
    );
  });

  it("is honest when nothing could be found", () => {
    const result = status(snapshot({ shortlist: { total: 0, suggested: 0 } }));
    expect(result.headline).toMatch(/couldn't find anyone/i);
    expect(result.nextAction).toBeUndefined();
  });

  it("asks what may be shared once people are picked", () => {
    const result = status(snapshot({ contacts: [contact({ consented: false }), contact({ id: "c2", name: "FIGHT vEDS", consented: false })] }));
    expect(result.step).toBe("choose");
    expect(result.nextAction?.kind).toBe("share_details");
    expect(result.headline).toBe("Choose what we may share with the 2 people you picked.");
  });

  it("names a single pick when asking about sharing", () => {
    const result = status(snapshot({ contacts: [contact({ consented: false })] }));
    expect(result.headline).toBe("Choose what we may share with Stanford Health Care.");
  });
});

describe("patientStatus: reaching out", () => {
  it("asks to approve the contact plan before any message", () => {
    for (const plan of [null, { status: "draft" as const }]) {
      const result = status(snapshot({ contacts: [contact()], plan }));
      expect(result.step).toBe("reach");
      expect(result.nextAction?.kind).toBe("approve_plan");
      expect(result.headline).toBe("Here's how we'll reach Stanford Health Care. Take a look.");
    }
  });

  it("shows the next message to approve, and never approves it itself", () => {
    const result = status(snapshot({ contacts: [contact()], plan: { status: "approved" } }));
    expect(result.headline).toBe("Your message to Stanford Health Care is ready. Take a look before it's sent.");
    expect(result.nextAction).toMatchObject({ kind: "approve_message", contactId: "c1", name: "Stanford Health Care" });
    expect(result.nextAction?.followUp).toBeUndefined();
    expect(result.tone).toBe("you");
  });

  it("surfaces a drafted follow-up instead of promising one", () => {
    const sent = contact({ state: "sent", approved: true, pendingFollowUp: true, nextFollowUpAt: "2026-10-27T16:00:00.000Z" });
    const result = status(snapshot({ contacts: [sent], plan: { status: "approved" } }));
    expect(result.headline).toBe("Stanford Health Care hasn't replied yet. Your follow-up is ready. Take a look before it's sent.");
    expect(result.nextAction).toMatchObject({ kind: "approve_message", contactId: "c1", followUp: true });
  });

  it("uses a voice draft's wording for calls", () => {
    const result = status(snapshot({ contacts: [contact({ channel: "voice" })], plan: { status: "approved" } }));
    expect(result.headline).toBe("Your call script for Stanford Health Care is ready. Take a look before we call.");
  });

  it("asks to review a filled-in online form", () => {
    const result = status(snapshot({
      contacts: [contact({ id: "c3", name: "Cleveland Clinic", state: "sent", approved: true })],
      applications: [{ id: "a1", contactId: "c3", status: "draft", submittedAt: null }],
      plan: { status: "approved" },
    }));
    expect(result.nextAction).toMatchObject({ kind: "approve_application", applicationId: "a1" });
    expect(result.headline).toBe("Your online form for Cleveland Clinic is filled in. Take a look before it's sent.");
  });

  it("puts a reply that needs the patient first", () => {
    const result = status(snapshot({
      contacts: [contact({ state: "task_open", approved: true }), contact({ id: "c2", name: "FIGHT vEDS" })],
      tasks: [{ id: "t1", contactId: "c1", kind: "records", title: "Send records", status: "open", dueAt: null }],
      plan: { status: "approved" },
    }));
    expect(result.headline).toBe("Stanford Health Care asked for your records. We can write the reply for you.");
    expect(result.nextAction).toMatchObject({ kind: "answer_task", taskId: "t1", taskKind: "records" });
  });

  it.each([
    ["referral", /referral/],
    ["slides", /slides/],
    ["call", /call/],
    ["redirect", /different contact/],
    ["unclear", /replied/],
    ["declined", /can't help/],
  ])("words a %s reply plainly", (kind, pattern) => {
    const result = status(snapshot({
      contacts: [contact({ state: "task_open", approved: true })],
      tasks: [{ id: "t1", contactId: "c1", kind, title: "x", status: "open", dueAt: null }],
      plan: { status: "approved" },
    }));
    expect(result.headline).toMatch(pattern);
    expect(result.nextAction?.kind).toBe("answer_task");
  });

  it("sends an application task to the form review, not the generic task approval", () => {
    const result = status(snapshot({
      contacts: [contact({ state: "task_open", approved: true })],
      tasks: [{ id: "t1", contactId: "c1", kind: "application", title: "Review application", status: "open", dueAt: null }],
      applications: [{ id: "a1", contactId: "c1", status: "draft", submittedAt: null }],
      plan: { status: "approved" },
    }));
    expect(result.nextAction?.kind).toBe("approve_application");
  });

  it("says when the follow-up will happen, in the viewer's time zone", () => {
    const sent = contact({ state: "sent", approved: true, nextFollowUpAt: "2026-10-27T16:00:00.000Z", lastActivityAt: "2026-10-24T14:30:00.000Z" });
    const result = status(snapshot({ contacts: [sent], plan: { status: "approved" } }));
    expect(result.headline).toBe("Sent to Stanford Health Care. If they don't reply, we'll follow up on Tuesday.");
    expect(result.tone).toBe("waiting");
    expect(result.nextAction).toBeUndefined();
    expect(result.updatedAt).toBe("2026-10-24T14:30:00.000Z");
    const tokyo = status(snapshot({ contacts: [{ ...sent, nextFollowUpAt: "2026-10-27T20:00:00.000Z" }], plan: { status: "approved" } }), "Asia/Tokyo");
    expect(tokyo.headline).toContain("Wednesday");
  });

  it("summarises several sent messages and picks the soonest follow-up", () => {
    const result = status(snapshot({
      contacts: [
        contact({ state: "sent", approved: true, nextFollowUpAt: "2026-10-30T16:00:00.000Z" }),
        contact({ id: "c2", name: "FIGHT vEDS", state: "sent", approved: true, nextFollowUpAt: "2026-10-27T16:00:00.000Z" }),
      ],
      plan: { status: "approved" },
    }));
    expect(result.headline).toBe("Sent to FIGHT vEDS and 1 other. If no one replies, we'll follow up on Tuesday.");
  });

  it("says sent without a date when no follow-up is scheduled", () => {
    const result = status(snapshot({ contacts: [contact({ state: "sent", approved: true })], plan: { status: "approved" } }));
    expect(result.headline).toBe("Sent to Stanford Health Care. We'll let you know as soon as they reply.");
  });

  it("offers someone else when one contact has stalled and nobody else is active", () => {
    const result = status(snapshot({ contacts: [contact({ state: "stalled", approved: true })], plan: { status: "approved" } }));
    expect(result.headline).toBe("Stanford Health Care hasn't replied after two follow-ups. Want to try someone else?");
    expect(result.nextAction?.kind).toBe("try_someone_else");
  });

  it("handles everyone stalled", () => {
    const result = status(snapshot({
      contacts: [contact({ state: "stalled", approved: true }), contact({ id: "c2", name: "FIGHT vEDS", state: "stalled", approved: true })],
      plan: { status: "approved" },
    }));
    expect(result.headline).toBe("None of the 2 people we wrote to have replied after two follow-ups. Want to try someone else?");
    expect(result.nextAction?.kind).toBe("try_someone_else");
    expect(result.tone).toBe("you");
  });

  it("mentions a stalled contact in the detail while others are still waiting", () => {
    const result = status(snapshot({
      contacts: [contact({ state: "sent", approved: true }), contact({ id: "c2", name: "FIGHT vEDS", state: "stalled", approved: true })],
      plan: { status: "approved" },
    }));
    expect(result.headline).toMatch(/^Sent to Stanford Health Care/);
    expect(result.detail).toBe("FIGHT vEDS hasn't replied after two follow-ups.");
  });

  it.each([
    ["appointment_booked", "Stanford Health Care set up an appointment. Check your email for the details."],
    ["connected", "You're connected with Stanford Health Care."],
    ["records_sent", "Your records are on their way to Stanford Health Care."],
    ["replied", "Stanford Health Care replied. We're working out the next step."],
  ])("shares good news for %s", (state, headline) => {
    const result = status(snapshot({ contacts: [contact({ state, approved: true })], plan: { status: "approved" } }));
    expect(result.headline).toBe(headline);
    expect(result.step).toBe("reach");
  });

  it("tells the patient when everyone declined", () => {
    const result = status(snapshot({ contacts: [contact({ state: "declined", approved: true })], plan: { status: "approved" } }));
    expect(result.nextAction?.kind).toBe("try_someone_else");
    expect(result.headline).toMatch(/can't help/);
  });
});

describe("patientStatus: safety and stability", () => {
  const ALL: PatientCaseSnapshot[] = [
    snapshot({ found: false }),
    snapshot({ caseStatus: "draft" }),
    snapshot({ caseStatus: "researching", runs: runs(3) }),
    snapshot({ caseStatus: "research_failed", shortlist: { total: 0, suggested: 0 } }),
    snapshot(),
    snapshot({ contacts: [contact({ consented: false })] }),
    snapshot({ contacts: [contact()] }),
    snapshot({ contacts: [contact()], plan: { status: "approved" } }),
    snapshot({ contacts: [contact({ state: "sent", approved: true, nextFollowUpAt: "2026-10-27T16:00:00.000Z" })], plan: { status: "approved" } }),
    snapshot({ contacts: [contact({ state: "stalled", approved: true })], plan: { status: "approved" } }),
  ];

  it("never words a status as medical advice", () => {
    for (const s of ALL) {
      const result = status(s);
      expect(flagMedicalAdvice(`${result.headline} ${result.detail ?? ""}`).flagged).toBe(false);
    }
  });

  it("is deterministic and its key changes only when the message does", () => {
    const a = status(snapshot());
    const b = status(snapshot());
    expect(a).toEqual(b);
    expect(statusKey(a)).toBe(statusKey(b));
    expect(statusKey(status(snapshot({ caseStatus: "researching", runs: runs(4) })))).not.toBe(
      statusKey(status(snapshot({ caseStatus: "researching", runs: runs(5) }))),
    );
  });

  it("every next action links to the detailed page for that step, without switching the saved view", () => {
    for (const s of ALL) {
      const action = status(s).nextAction;
      if (action) expect(action.detailsHref).toMatch(new RegExp(`^(/start\\?view=judge|/cases/${ID}/[a-z]+)$`));
    }
  });
});
