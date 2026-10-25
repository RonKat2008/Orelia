import { describe, expect, it, vi } from "vitest";
import { loadJourney } from "../../components/journey/load";
import {
  countSelected,
  readOpenTaskCount,
  resolveJourney,
  summarizeCase,
} from "../../components/journey/model";

const caseId = "11111111-1111-4111-8111-111111111111";

function plan(status: string | null, extra: Partial<Parameters<typeof resolveJourney>[1]> = {}) {
  return resolveJourney(caseId, {
    status,
    selectedCount: 0,
    openTaskCount: 0,
    contacts: [],
    ...extra,
  });
}

describe("resolveJourney", () => {
  it("starts at intake until the case is confirmed", () => {
    expect(plan(null).current).toBe("intake");
    expect(plan("extracted").current).toBe("intake");
    expect(plan("unconfirmed").nextHref).toBe("/start");
  });

  it("stays on research while the swarm is running or failed", () => {
    expect(plan("confirmed").current).toBe("research");
    expect(plan("researching").nextHref).toBe(`/cases/${caseId}/swarm`);
    expect(plan("research_failed").notes.join(" ")).toMatch(/did not finish/);
  });

  it("moves from shortlist to consent, outreach, then tracker", () => {
    expect(plan("ready", { selectedCount: 0, contacts: null }).current).toBe("shortlist");
    expect(plan("ready", { selectedCount: 2, contacts: null }).current).toBe("consent");
    expect(
      plan("ready", {
        selectedCount: 2,
        contacts: [{ consented: false, approved: false, state: "drafted" }],
      }).current,
    ).toBe("consent");
    expect(
      plan("ready", {
        selectedCount: 1,
        contacts: [{ consented: true, approved: false, state: "drafted" }],
      }).nextHref,
    ).toBe(`/cases/${caseId}/outbox`);
    expect(
      plan("ready", {
        selectedCount: 1,
        contacts: [{ consented: true, approved: true, state: "sent" }],
        openTaskCount: 1,
      }).current,
    ).toBe("tracker");
  });

  it("marks earlier steps complete and names a single current step", () => {
    const resolved = plan("ready", { selectedCount: 1, contacts: null });
    expect(resolved.steps.map((step) => step.id)).toEqual([
      "intake", "research", "shortlist", "consent", "plan", "outreach", "tracker",
    ]);
    expect(resolved.steps.find((step) => step.id === "plan")?.href).toBe(`/cases/${caseId}/plan`);
    expect(resolved.steps.filter((step) => step.state === "current").map((step) => step.id)).toEqual(["consent"]);
    expect(resolved.steps.filter((step) => step.state === "complete").map((step) => step.id)).toEqual([
      "intake",
      "research",
      "shortlist",
    ]);
  });

  it("notes when shortlist or tasks are missing", () => {
    const resolved = plan("ready", { selectedCount: null, openTaskCount: null, contacts: null });
    expect(resolved.notes.join(" ")).toMatch(/shortlist could not be loaded/i);
    expect(resolved.notes.join(" ")).toMatch(/could not be loaded/);
  });
});

describe("parsers", () => {
  it("reads a case, selected shortlist rows, and open tasks", () => {
    expect(
      summarizeCase({
        case: {
          diseaseName: "Epithelioid sarcoma",
          homeCity: "Tempe",
          homeState: "AZ",
          goals: ["trial"],
          status: "ready",
        },
      }),
    ).toMatchObject({ diseaseName: "Epithelioid sarcoma", location: "Tempe, AZ", status: "ready" });
    expect(countSelected({ groups: { expert: [{ selected: true }, { selected: false }], trial: [] } })).toBe(1);
    expect(countSelected({ items: [] })).toBeNull();
    expect(readOpenTaskCount({ tasks: [{ status: "open" }, { status: "done" }] })).toBe(1);
  });
});

describe("loadJourney", () => {
  it("degrades when later endpoints are missing", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/shortlist")) return new Response("nope", { status: 404 });
      if (url.endsWith("/contacts")) return new Response("nope", { status: 404 });
      return new Response(
        JSON.stringify({
          case: { diseaseName: "Vascular EDS", status: "researching", goals: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const loaded = await loadJourney(caseId, fetchImpl as unknown as typeof fetch);
    expect(loaded.summary?.diseaseName).toBe("Vascular EDS");
    expect(loaded.selectedCount).toBeNull();
    expect(loaded.contacts).toBeNull();
    expect(loaded.missingCase).toBe(false);
  });

  it("asks for the plan as optional so a case without one does not log a 404", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("/plan")) return new Response(JSON.stringify({ plan: null }), { status: 200 });
      return new Response(JSON.stringify({ case: { diseaseName: "Vascular EDS", status: "ready", goals: [] } }), { status: 200 });
    });
    const loaded = await loadJourney(caseId, fetchImpl as unknown as typeof fetch);
    expect(urls).toContain(`/api/cases/${caseId}/plan?optional=1`);
    expect(loaded.planStatus).toBeNull();
  });

  it("requests every endpoint in one parallel round, not a waterfall", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchImpl = vi.fn(async () => {
      started += 1;
      if (started === 5) release();
      await gate;
      return new Response(JSON.stringify({ case: { diseaseName: "Vascular EDS", status: "ready", goals: [] } }), { status: 200 });
    });
    const loaded = await loadJourney(caseId, fetchImpl as unknown as typeof fetch);
    expect(started).toBe(5);
    expect(loaded.summary?.diseaseName).toBe("Vascular EDS");
  });

  it("records a missing case", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 404 }));
    const loaded = await loadJourney(caseId, fetchImpl as unknown as typeof fetch);
    expect(loaded.missingCase).toBe(true);
  });
});

describe("resolveJourney: contact plan", () => {
  const consented = [{ consented: true, approved: false, state: "drafted" }];

  it("shows Plan as current while a draft plan waits for review", () => {
    const resolved = plan("ready", { selectedCount: 1, contacts: consented, planStatus: "draft" });
    expect(resolved.current).toBe("plan");
    expect(resolved.nextHref).toBe(`/cases/${caseId}/plan`);
    expect(resolved.steps.find((s) => s.id === "consent")?.state).toBe("complete");
    expect(resolved.steps.find((s) => s.id === "plan")?.state).toBe("current");
  });

  it("moves to the outbox once the plan is approved", () => {
    expect(plan("ready", { selectedCount: 1, contacts: consented, planStatus: "approved" }).current).toBe("outreach");
  });

  it("consent still comes first, and replies still win", () => {
    expect(
      plan("ready", { selectedCount: 1, contacts: [{ consented: false, state: "drafted" }], planStatus: "draft" }).current,
    ).toBe("consent");
    expect(
      plan("ready", { selectedCount: 1, contacts: [{ consented: true, approved: true, state: "sent" }], planStatus: "draft" }).current,
    ).toBe("tracker");
  });

  it("loadJourney reads the plan status and tolerates a missing plan", async () => {
    const routes: Record<string, unknown> = {
      [`/api/cases/${caseId}`]: { case: { diseaseName: "Synthetic", status: "ready" } },
      [`/api/cases/${caseId}/plan?optional=1`]: { plan: { status: "approved" } },
    };
    const fetchImpl = vi.fn(async (url: string) =>
      routes[url] ? new Response(JSON.stringify(routes[url]), { status: 200 }) : new Response("{}", { status: 404 }),
    ) as unknown as typeof fetch;
    expect((await loadJourney(caseId, fetchImpl)).planStatus).toBe("approved");
    delete routes[`/api/cases/${caseId}/plan?optional=1`];
    expect((await loadJourney(caseId, fetchImpl)).planStatus).toBeNull();
  });
});

describe("journey stage from server contacts", () => {
  it("moves past the shortlist once contacts exist, even when the shortlist reports no selection", () => {
    // Selection lives in the browser session; the shortlist API never marks items selected.
    const sent = plan("ready", {
      selectedCount: 0,
      contacts: [{ consented: true, approved: true, state: "replied" }],
      openTaskCount: 1,
    });
    expect(sent.current).toBe("tracker");
    const unconsented = plan("ready", { selectedCount: 0, contacts: [{ consented: false, approved: false, state: "drafted" }] });
    expect(unconsented.current).toBe("consent");
  });

  it("stays on the shortlist when nothing is selected and no contact exists", () => {
    expect(plan("ready", { selectedCount: 0, contacts: [] }).current).toBe("shortlist");
  });
});
