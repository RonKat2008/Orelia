import { describe, expect, it, vi } from "vitest";
import { contactsFromActivity, loadCaseContacts, loadCaseTasks, tasksFromActivity } from "../../components/outreach/case-activity";
import { readContacts, readTasks } from "../../components/journey/model";
import { parseThreads } from "../../components/threads/model";
import { normalizeShortlist, selectionKey } from "../../components/shortlist/data";

const caseId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";

describe("activity adapters", () => {
  it("reads displayName, state and nextFollowUpAt from the contacts API", () => {
    const body = {
      caseId,
      openTaskCount: 1,
      contacts: [{
        id: contactId,
        targetKind: "expert",
        targetId: "44444444-4444-4444-8444-444444444444",
        displayName: "Dr Ada",
        channel: "email",
        state: "sent",
        nextFollowUpAt: "2026-10-27T15:00:00.000Z",
        lastActivityAt: null,
        consented: true,
        approved: false,
      }],
    };
    const contacts = contactsFromActivity(body);
    expect(contacts?.[0].displayName).toBe("Dr Ada");
    expect(contacts?.[0].state).toBe("sent");
    expect(contacts?.[0].nextFollowUpAt).toBe("2026-10-27T15:00:00.000Z");
    expect(readContacts(body)?.[0]).toMatchObject({ name: "Dr Ada", state: "sent", consented: true });
  });

  it("reads task titles for Needs you now", () => {
    const body = {
      caseId,
      tasks: [{ id: "55555555-5555-4555-8555-555555555555", contactId, kind: "records", title: "Send records", status: "open", dueAt: null }],
    };
    const names = new Map([[contactId, "Dr Ada"]]);
    expect(tasksFromActivity(body, names)?.[0]).toMatchObject({ summary: "Send records", contactName: "Dr Ada", kind: "records" });
    expect(readTasks(body)?.[0].summary).toBe("Send records");
  });

  it("parses thread messages and a string classification", () => {
    const threads = parseThreads({
      caseId,
      threads: [{
        contactId,
        label: "Dr Ada",
        messages: [{
          id: "66666666-6666-4666-8666-666666666666",
          direction: "inbound",
          channel: "email",
          subject: "Re: introduction",
          body: "Please send the records.",
          sharedFields: [],
          at: "2026-10-24T12:00:00.000Z",
          classification: "send_records",
        }],
      }],
    });
    expect(threads[0].label).toBe("Dr Ada");
    expect(threads[0].entries[0].classification?.label).toBe("Send records");
  });

  it("keeps caseCandidateId so consent selects the case candidate, not the resource id", () => {
    const payload = normalizeShortlist({
      groups: {
        expert: [{
          targetKind: "expert",
          targetId: "77777777-7777-4777-8777-777777777777",
          caseCandidateId: candidateId,
          name: "Dr Ada",
          score: 10,
          breakdown: [],
          evidence: [],
          tier: "best",
        }],
      },
      suggested: [{ targetId: "77777777-7777-4777-8777-777777777777" }],
    });
    expect(payload?.items[0] && selectionKey(payload.items[0])).toBe(candidateId);
    expect(payload?.suggested).toEqual([candidateId]);
  });

  it("loads contacts from the case route and does not invent rows when the route fails", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ contacts: [] }), { status: 200 }));
    await expect(loadCaseContacts(caseId, fetchImpl as unknown as typeof fetch)).resolves.toEqual([]);
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(loadCaseTasks(caseId, new Map(), failing as unknown as typeof fetch)).resolves.toBeNull();
  });
});
