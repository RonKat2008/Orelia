import { describe, expect, it, vi } from "vitest";
import { CONTACT_APPROVED, createConnectionWorkflow, initialContext, type ConnectionDeps, type ContactContext, type WorkflowStep } from "../../lib/workflows";
import { canonicalFollowUp } from "../../lib/outreach/preapprove";
import { MemoryFollowUpPlan, resolvePreapprovedSend } from "../../lib/outreach/follow-up-plan";
import type { CaseSnapshot } from "../../lib/outreach/preapprove";

const NOW = new Date("2026-03-02T15:00:00Z");
const CID = "c-1";
const CASE = "case-1";
const snapshot: CaseSnapshot = {
  diseaseName: "synthetic", diseaseCodes: null, subtype: null, stageSummary: null, homeCity: null,
  homeState: "CA", insurer: null, planId: null, travelLimitMiles: null, goals: [],
};

class FakeStep implements WorkflowStep {
  ids = new Set<string>();
  private claim(id: string) { if (this.ids.has(id)) throw new Error(`duplicate step id: ${id}`); this.ids.add(id); }
  async run<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    this.claim(id);
    const v = await fn();
    return (v === undefined ? v : JSON.parse(JSON.stringify(v))) as T;
  }
  async waitForEvent(id: string): Promise<null> { this.claim(id); return null; }
  async sendEvent(id: string) { this.claim(id); return {}; }
}

async function run(plan: MemoryFollowUpPlan, notify: (input: { reason: string }) => Promise<void> = vi.fn(async () => {})) {
  const store = new Map<string, ContactContext>([[CID, initialContext()]]);
  const approvals = new Map<string, string>([["m-1", NOW.toISOString()]]);
  const bodies: string[] = [];
  const send = vi.fn(async (input: { messageId: string; kind: string }) => {
    if (input.kind === "follow_up") {
      const row = await plan.getMessage(CID, store.get(CID)!.followUpsDue as 1 | 2);
      bodies.push(row?.body ?? "");
      expect(input.messageId).toBe(row?.id);
    }
    return { providerRef: "ref" };
  });
  const deps: ConnectionDeps = {
    clock: { now: () => NOW, scale: 1 },
    send,
    draftFollowUp: vi.fn(async () => ({ messageId: "draft" })),
    loadMessageApproval: async (id) => approvals.get(id) ?? (await plan.getMessage(CID, 1))?.id === id ? (await plan.getMessage(CID, 1))!.approvedAt : (await plan.getMessage(CID, 2))?.approvedAt ?? null,
    loadContext: async () => structuredClone(store.get(CID)!),
    saveContext: async (_id, ctx) => { store.set(CID, structuredClone(ctx)); },
    resolvePreapproved: (input) => resolvePreapprovedSend(plan, input),
    notifyApprovalNeeded: notify,
    cancelPreapproved: async ({ contactId, reason }) => { await plan.cancelPending(contactId, reason); },
  };
  // approvals for preapproved ids are loaded from the plan inside loadMessageApproval
  const out = await createConnectionWorkflow(deps).handler({
    event: { name: CONTACT_APPROVED, data: { contactId: CID, caseId: CASE, messageId: "m-1", approvedAt: NOW.toISOString() } },
    step: new FakeStep(),
  });
  return { out, send, bodies, store, deps };
}

describe("workflow sends pre-approved follow-ups", () => {
  it("sends the byte-identical day-3 body when there is no reply", async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({
      contactId: CID, caseId: CASE, channel: "email", contactState: "sent", sharedFields: [],
      consentApprovedAt: "2026-03-01T00:00:00.000Z", snapshot, approvedAt: NOW,
    });
    const { out, send, bodies } = await run(plan);
    expect(out).toEqual({ outcome: "stalled" });
    const followUps = send.mock.calls.filter((c) => c[0].kind === "follow_up");
    expect(followUps).toHaveLength(2);
    expect(bodies[0]).toBe(canonicalFollowUp("email").body);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("does not send after a consent change and notifies once per follow-up", async () => {
    const plan = new MemoryFollowUpPlan();
    await plan.approve({
      contactId: CID, caseId: CASE, channel: "email", contactState: "sent", sharedFields: ["disease_name"],
      consentApprovedAt: "2026-03-01T00:00:00.000Z", snapshot, approvedAt: NOW,
    });
    plan.setContext(CID, { sharedFields: [] });
    const notify = vi.fn(async (_input: { reason: string }) => {});
    const { send } = await run(plan, notify);
    expect(send.mock.calls.filter((c) => c[0].kind === "follow_up")).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0].reason).toBe("consent_changed");
  });
});
