import { describe, expect, it } from "vitest";
import { buildActivity, buildNeeds, readTasks, resolveJourney } from "../../components/journey/model";

const caseId = "case-1";
const plan = resolveJourney(caseId, { status: "ready", selectedCount: 1, openTaskCount: 1, contacts: null });

describe("buildNeeds", () => {
  it("leads with the next step, then open tasks only", () => {
    const tasks = readTasks({
      tasks: [
        { id: "a", summary: "Send slides", contactName: "Clinic", status: "open" },
        { id: "b", summary: "Done thing", status: "done" },
      ],
    });
    const needs = buildNeeds(plan, tasks, caseId);
    expect(needs.map((n) => n.id)).toEqual(["next", "a"]);
    expect(needs[1].text).toBe("Send slides (Clinic)");
    expect(needs[1].href).toBe(`/cases/${caseId}/tracker`);
  });

  it("still names a next step when tasks are unavailable", () => {
    expect(buildNeeds(plan, null, caseId)).toHaveLength(1);
  });
});

describe("buildActivity", () => {
  it("is empty without data and caps at six rows", () => {
    expect(buildActivity(null, null)).toEqual([]);
    const contacts = Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, state: "sent" }));
    expect(buildActivity(contacts, null)).toHaveLength(6);
  });
  it("humanises states", () => {
    expect(buildActivity([{ name: "Lab", state: "task_open" }], null)[0].text).toBe("Lab: task open");
  });
});
