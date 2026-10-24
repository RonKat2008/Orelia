import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { MemoryFollowUpPlan, resolvePreapprovedSend } from "../../lib/outreach/follow-up-plan";
import { assessPreapproved, canonicalFollowUp, type CaseSnapshot } from "../../lib/outreach/preapprove";
import { GET, PUT } from "../../app/api/cases/[id]/follow-up-plan/route";
import { setFollowUpPlanForTests } from "../../lib/outreach/follow-up-plan";

const snapshot: CaseSnapshot = {
  diseaseName: "synthetic", diseaseCodes: null, subtype: null, stageSummary: null,
  homeCity: "Austin", homeState: "TX", insurer: null, planId: null, travelLimitMiles: null, goals: ["support"],
};
const CASE = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";

function planInput(over: Record<string, unknown> = {}) {
  return {
    contactId: CONTACT, caseId: CASE, channel: "email" as const, contactState: "sent",
    sharedFields: ["disease_name"], consentApprovedAt: "2026-03-01T00:00:00.000Z", snapshot, ...over,
  };
}

const holder = globalThis as unknown as { __wayfinderOwnerStore?: MemoryOwnerStore };
const OWNER = "preapprove-owner";
const authed = (method: string, body?: unknown) => new Request("http://local/api", {
  method,
  headers: { cookie: `wf_session=${signSession(OWNER)}`, origin: "http://local" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("pre-approved follow-ups", () => {
  beforeEach(() => {
    vi.stubEnv("WAYFINDER_SESSION_SECRET", "synthetic-preapprove-secret");
    const store = new MemoryOwnerStore();
    store.registerCase(CASE, OWNER);
    store.registerContact(CONTACT, CASE);
    holder.__wayfinderOwnerStore = store;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete holder.__wayfinderOwnerStore;
  });

  it("stores the canonical day-3 and day-7 bodies with approved_at", async () => {
    const plan = new MemoryFollowUpPlan();
    const rows = await plan.approve({ ...planInput(), approvedAt: new Date("2026-03-02T15:00:00.000Z") });
    const canonical = canonicalFollowUp("email");
    expect(rows.map((r) => r.classification)).toEqual(["follow_up_1", "follow_up_2"]);
    for (const row of rows) {
      expect(row.body).toBe(canonical.body);
      expect(row.approvedAt).toBe("2026-03-02T15:00:00.000Z");
      expect(row.sharedFields).toEqual(["disease_name"]);
    }
    const decision = await resolvePreapprovedSend(plan, { contactId: CONTACT, followUpNumber: 1 });
    expect(decision).toMatchObject({ action: "send", body: canonical.body });
  });

  it("does not send after revoke, reply, or a consent change", async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({ ...planInput(), approvedAt: new Date("2026-03-02T15:00:00.000Z") });
    await plan.revoke(CONTACT);
    expect((await resolvePreapprovedSend(plan, { contactId: CONTACT, followUpNumber: 1 })).action).toBe("hold");

    const again = new MemoryFollowUpPlan();
    await again.approve({ ...planInput(), approvedAt: new Date("2026-03-02T15:00:00.000Z") });
    again.setContext(CONTACT, { contactState: "replied" });
    const replied = await resolvePreapprovedSend(again, { contactId: CONTACT, followUpNumber: 1 });
    expect(replied).toEqual({ action: "hold", reason: "replied" });
    expect((await again.getMessage(CONTACT, 2))?.approvedAt).toBeNull();

    const changed = new MemoryFollowUpPlan();
    await changed.approve({ ...planInput(), approvedAt: new Date("2026-03-02T15:00:00.000Z") });
    changed.setContext(CONTACT, { sharedFields: ["home_city"] });
    const blocked = await resolvePreapprovedSend(changed, { contactId: CONTACT, followUpNumber: 1 });
    expect(blocked).toEqual({ action: "hold", reason: "consent_changed" });
  });

  it("blocks a body that would differ from the stored row", async () => {
    const plan = new MemoryFollowUpPlan();
    const [row] = await plan.approve({ ...planInput(), approvedAt: new Date("2026-03-02T15:00:00.000Z") });
    const message = await plan.getMessage(CONTACT, 1);
    const ctx = await plan.contextFor(CONTACT);
    expect(message && ctx && assessPreapproved({ ...message, body: row.body + " extra" }, ctx)).toEqual({ ok: false, reason: "body_differs" });
  });

  it("GET/PUT follow-up plan and refuses a non-allowlisted patient address in dev", async () => {
    const plan = new MemoryFollowUpPlan();
    setFollowUpPlanForTests(plan);
    const ctx = { params: Promise.resolve({ id: CASE }) };
    const bad = await PUT(authed("PUT", { notification: { patientEmail: "patient@example.com", optIn: true } }), ctx);
    expect(bad.status).toBe(400);
    process.env.OUTBOUND_ALLOWLIST = "patient@example.com";
    const ok = await PUT(authed("PUT", {
      contactId: CONTACT, action: "approve", channel: "email", sharedFields: ["disease_name"],
      consentApprovedAt: "2026-03-01T00:00:00.000Z", snapshot,
      notification: { patientEmail: "Patient@Example.com", optIn: true },
    }), ctx);
    expect(ok.status).toBe(200);
    const listed = await GET(authed("GET"), ctx);
    const json = await listed.json();
    expect(json.followUps).toHaveLength(2);
    expect(json.notification.patientEmail).toBe("patient@example.com");
    expect(json.notification.optIn).toBe(true);
    setFollowUpPlanForTests(null);
    delete process.env.OUTBOUND_ALLOWLIST;
  });
});
