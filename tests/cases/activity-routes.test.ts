import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as contactsGet } from "../../app/api/cases/[id]/contacts/route";
import { GET as shortlistGet } from "../../app/api/cases/[id]/shortlist/route";
import { GET as tasksGet } from "../../app/api/cases/[id]/tasks/route";
import { GET as threadsGet } from "../../app/api/cases/[id]/threads/route";
import { getServices } from "../../app/api/cases/_lib/services";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";
import { asMemoryActivity, getCaseActivity, resetCaseActivity } from "../../lib/cases/activity";
import type { Resource } from "../../lib/contracts";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const cookie = (id: string) => `wf_session=${signSession(id, { WAYFINDER_SESSION_SECRET: SECRET })}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const saved: Record<string, string | undefined> = {};
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown; __wayfinderServices?: unknown };

let store: MemoryOwnerStore;
let caseId: string;
let otherCaseId: string;

const contactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherContactId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const targetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(async () => {
  for (const key of ["WAYFINDER_SESSION_SECRET", "WAYFINDER_DEMO", "DATABASE_URL"]) saved[key] = process.env[key];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.WAYFINDER_DEMO;
  delete process.env.DATABASE_URL;
  delete holder.__wayfinderServices;
  resetCaseActivity();
  store = new MemoryOwnerStore();
  holder.__wayfinderOwnerStore = store;
  const cases = getServices().cases;
  caseId = (await cases.create({ diseaseName: "Synthetic disease", goals: [] } as never, "ready")).id;
  otherCaseId = (await cases.create({ diseaseName: "Other disease", goals: [] } as never, "ready")).id;
  store.registerCase(caseId, "owner");
  store.registerCase(otherCaseId, "owner");
  const activity = asMemoryActivity(getCaseActivity());
  activity.seedContact(caseId, {
    id: contactId,
    targetKind: "institution",
    targetId,
    displayName: "Preview center",
    channel: "email",
    state: "sent",
    nextFollowUpAt: "2026-10-28T16:00:00.000Z",
    lastActivityAt: "2026-10-24T16:00:00.000Z",
    consented: true,
    approved: true,
  });
  activity.seedContact(otherCaseId, {
    id: otherContactId,
    targetKind: "expert",
    targetId,
    displayName: "Other specialist",
    channel: "voice",
    state: "drafted",
    nextFollowUpAt: null,
    lastActivityAt: null,
    consented: false,
    approved: false,
  });
  activity.seedTask(caseId, {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    contactId,
    kind: "records",
    title: "Send the records packet",
    status: "open",
    dueAt: "2026-10-30T16:00:00.000Z",
  });
  activity.seedTask(caseId, {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    contactId,
    kind: "call",
    title: "Finished call",
    status: "approved",
    dueAt: null,
  });
  activity.seedMessage(caseId, {
    contactId,
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    direction: "inbound",
    channel: "email",
    subject: "Scheduling",
    body: "We received the referral.",
    sharedFields: ["diseaseName"],
    at: "2026-10-24T16:00:00.000Z",
    classification: "call_to_schedule",
  });
  activity.seedMessage(caseId, {
    contactId,
    id: "11111111-1111-4111-8111-111111111111",
    direction: "outbound",
    channel: "voice",
    subject: null,
    body: "Call transcript: screening window discussed.",
    sharedFields: [],
    at: "2026-10-24T17:00:00.000Z",
    classification: null,
  });
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete holder.__wayfinderOwnerStore;
  delete holder.__wayfinderServices;
  resetCaseActivity();
});

const get = (route: typeof contactsGet, id: string, who: string) =>
  route(new Request(`${ORIGIN}/api/cases/${id}`, { headers: { cookie: cookie(who) } }), ctx(id));

describe("case activity routes", () => {
  it("refuses another session and a cross-case read", async () => {
    expect((await get(contactsGet, caseId, "other")).status).toBe(404);
    expect((await get(tasksGet, caseId, "other")).status).toBe(404);
    expect((await get(threadsGet, caseId, "other")).status).toBe(404);

    const contacts = await (await get(contactsGet, caseId, "owner")).json();
    expect(contacts.contacts.map((row: { displayName: string }) => row.displayName)).toEqual(["Preview center"]);
    expect(JSON.stringify(contacts)).not.toContain("Other specialist");

    const tasks = await (await get(tasksGet, caseId, "owner")).json();
    expect(tasks.tasks).toHaveLength(2);
    expect(tasks.tasks.every((row: { contactId: string }) => row.contactId === contactId)).toBe(true);
  });

  it("returns contacts, open tasks, and threads for the owner", async () => {
    const contacts = await (await get(contactsGet, caseId, "owner")).json();
    expect(contacts.contacts[0]).toMatchObject({
      id: contactId,
      displayName: "Preview center",
      channel: "email",
      state: "sent",
      nextFollowUpAt: "2026-10-28T16:00:00.000Z",
      lastActivityAt: "2026-10-24T16:00:00.000Z",
      consented: true,
      approved: true,
    });
    expect(contacts.openTaskCount).toBe(1);
    expect(contacts.contacts[0].address).toBeUndefined();

    const tasks = await (await get(tasksGet, caseId, "owner")).json();
    expect(tasks.tasks.map((row: { status: string }) => row.status).sort()).toEqual(["approved", "open"]);
    expect(tasks.tasks.find((row: { status: string }) => row.status === "open")).toMatchObject({
      kind: "records",
      title: "Send the records packet",
      dueAt: "2026-10-30T16:00:00.000Z",
    });

    const threads = await (await get(threadsGet, caseId, "owner")).json();
    expect(threads.threads).toHaveLength(1);
    expect(threads.threads[0].label).toBe("Preview center");
    expect(threads.threads[0].messages.map((row: { body: string }) => row.body)).toEqual([
      "We received the referral.",
      "Call transcript: screening window discussed.",
    ]);
  });

  it("adds case candidate ids, trial nct ids, and organization kind without dropping ranked fields", async () => {
    const trialId = "22222222-2222-4222-8222-222222222222";
    const orgId = "33333333-3333-4333-8333-333333333333";
    const trial: Resource = { kind: "trial", id: trialId, nctId: "NCT09999999", title: "Synthetic trial", evidenceRefs: [] };
    const org: Resource = { kind: "organization", id: orgId, name: "Synthetic aid", organizationKind: "financial_aid", evidenceRefs: [] };
    await getServices().persist.saveResults(caseId, [
      { record: { resource: trial, key: "trial:nct:NCT09999999", evidence: [] }, score: 10, rank: 1, breakdown: [] },
      { record: { resource: org, key: "org:synthetic", evidence: [] }, score: 8, rank: 1, breakdown: [] },
    ]);
    const body = await (await get(shortlistGet, caseId, "owner")).json();
    const trialRow = body.groups.trial[0];
    const orgRow = body.groups.organization[0];
    expect(trialRow).toMatchObject({ targetId: trialId, name: "Synthetic trial", rank: 1, nctId: "NCT09999999", organizationKind: null });
    expect(trialRow.caseCandidateId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(orgRow).toMatchObject({ targetId: orgId, name: "Synthetic aid", organizationKind: "financial_aid", nctId: null });
    expect(orgRow.caseCandidateId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body.groups.expert).toEqual([]);
  });
});
