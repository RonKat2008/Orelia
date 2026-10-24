import { describe, expect, it } from "vitest";
import { MemoryConditionBriefStore } from "@/lib/condition-brief/store";
import { makeBrief } from "./brief-fixture";

describe("MemoryConditionBriefStore", () => {
  it("returns null when empty and round-trips a brief", async () => {
    const s = new MemoryConditionBriefStore();
    expect(await s.latest("c1")).toBeNull();
    await s.save(makeBrief("c1"));
    expect(await s.latest("c1")).toEqual(makeBrief("c1"));
    await s.save(makeBrief("c1", { version: 2 }));
    expect((await s.latest("c1"))?.version).toBe(2);
  });

  it("is immutable to callers", async () => {
    const s = new MemoryConditionBriefStore();
    const brief = makeBrief("c1");
    await s.save(brief);
    brief.diseaseName = "changed";
    const read = await s.latest("c1");
    read!.questions.push({ id: "x", text: "Is this mutated?", statementIds: [] });
    expect(await s.latest("c1")).toEqual(makeBrief("c1"));
  });

  it("rejects an invalid brief", async () => {
    await expect(new MemoryConditionBriefStore().save({ ...makeBrief("c1"), version: 0 })).rejects.toThrow(/invalid/);
  });
});
