import { describe, expect, it, vi } from "vitest";
import {
  approvalBody,
  approveContactDraft,
  approveTask,
  consentBody,
  refusalMessages,
  selectBody,
  selectOutreach,
} from "@/components/outreach/client";

const draftId = "33333333-3333-4333-8333-333333333331";
const contactId = "22222222-2222-4222-8222-222222222221";
const caseId = "11111111-1111-4111-8111-111111111111";
const candidateId = "44444444-4444-4444-8444-444444444441";

describe("outreach UI request shapes", () => {
  it("posts selection with case id and candidate ids only", () => {
    expect(selectBody(caseId, [candidateId])).toEqual({ caseId, candidateIds: [candidateId] });
  });

  it("puts consent as sharedFields and uses diseaseName for diagnosis", () => {
    expect(consentBody(["diseaseName", "homeState"])).toEqual({ sharedFields: ["diseaseName", "homeState"] });
  });

  it("approves a draft with only draftId", async () => {
    expect(approvalBody(draftId)).toEqual({ draftId });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ draftId });
      expect(init?.body).not.toContain("approvedAt");
      expect(init?.body).not.toContain("taskId");
      return new Response(JSON.stringify({ draftId, approvedAt: "2026-10-24T00:00:00.000Z", sentAt: null }), { status: 200 });
    });
    const result = await approveContactDraft(contactId, draftId, fetchImpl as typeof fetch);
    expect(result).toEqual({ ok: true, approvedAt: "2026-10-24T00:00:00.000Z", sentAt: null });
    expect(fetchImpl).toHaveBeenCalledWith(`/api/contacts/${contactId}/approve`, expect.objectContaining({ method: "POST" }));
  });

  it("does not mark approval when the server omits approvedAt", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ draftId }), { status: 200 }));
    const result = await approveContactDraft(contactId, draftId, fetchImpl as typeof fetch);
    expect(result.ok).toBe(false);
  });

  it("shows every 422 gate reason", async () => {
    const reasons = ["not_allowlisted", "missing_disclosure", "unshared_field"];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ reasons }), { status: 422 }));
    const result = await approveContactDraft(contactId, draftId, fetchImpl as typeof fetch);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.reasons).toHaveLength(3);
    expect(result.reasons.join(" ")).toContain("allowlist");
    expect(result.reasons.join(" ")).toContain("disclosure");
    expect(result.reasons.join(" ")).toContain("did not agree");
    expect(refusalMessages(reasons)).toEqual(result.reasons);
  });

  it("keeps channel none on the selection result", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual(selectBody(caseId, [candidateId]));
      return new Response(
        JSON.stringify({
          contacts: [],
          unavailable: [{ candidateId, channel: "none", reason: "No evidenced intake email or phone is available." }],
        }),
        { status: 200 },
      );
    });
    const result = await selectOutreach(caseId, [candidateId], fetchImpl as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unavailable[0]?.channel).toBe("none");
  });

  it("leaves a task unapproved when the task API is missing", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({});
      return new Response("not found", { status: 404 });
    });
    const result = await approveTask("55555555-5555-4555-8555-555555555551", fetchImpl as typeof fetch);
    expect(result).toMatchObject({ available: false });
  });
});
