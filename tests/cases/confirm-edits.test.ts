import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../../app/api/cases/[id]/route";
import { getServices } from "../../app/api/cases/_lib/services";
import { confirmAndResearch } from "../../components/intake/case-client";
import { MemoryOwnerStore } from "../../lib/auth/ownership";
import { signSession } from "../../lib/auth/session";

const SECRET = "test-secret";
const ORIGIN = "http://localhost";
const cookie = `wf_session=${signSession("owner", { WAYFINDER_SESSION_SECRET: SECRET })}`;
const holder = globalThis as unknown as { __wayfinderOwnerStore?: unknown };
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ["WAYFINDER_SESSION_SECRET", "DATABASE_URL"]) saved[k] = process.env[k];
  process.env.WAYFINDER_SESSION_SECRET = SECRET;
  delete process.env.DATABASE_URL;
  holder.__wayfinderOwnerStore = new MemoryOwnerStore();
  vi.stubGlobal("sessionStorage", { setItem() {}, getItem: () => null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete holder.__wayfinderOwnerStore;
});

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`${ORIGIN}/api/cases/${id}`, {
      method: "PATCH",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

describe("confirm step saves the patient's edits", () => {
  it("the body confirmAndResearch sends changes the stored case", async () => {
    const created = await getServices().cases.create({ diseaseName: "Extracted name", goals: [] }, "draft");
    (holder.__wayfinderOwnerStore as MemoryOwnerStore).registerCase(created.id, "owner");

    let sent = "";
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        sent = String(init.body);
        return patch(created.id, JSON.parse(sent));
      }
      return new Response("{}", { status: 202 });
    });
    await confirmAndResearch({ ...created, diseaseName: "Edited by patient", homeState: "NY", goals: ["trial"] });

    expect((await getServices().cases.get(created.id))?.diseaseName).toBe("Edited by patient");
    expect((await getServices().cases.get(created.id))?.homeState).toBe("NY");
  });

  it("rejects a PATCH body with unknown top-level keys instead of silently dropping the edits", async () => {
    const created = await getServices().cases.create({ diseaseName: "A", goals: [] }, "draft");
    (holder.__wayfinderOwnerStore as MemoryOwnerStore).registerCase(created.id, "owner");
    expect((await patch(created.id, { diseaseName: "B" })).status).toBe(400);
  });
});

describe("confirm step field errors", () => {
  it("names the field when the state is not a US state, before any request is made", async () => {
    const { InvalidFields } = await import("../../components/intake/case-client");
    const created = await getServices().cases.create({ diseaseName: "A", goals: [] }, "draft");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(confirmAndResearch({ ...created, homeState: "ZZ" })).rejects.toBeInstanceOf(InvalidFields);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
