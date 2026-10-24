import { describe, expect, it } from "vitest";
import { taskKindSchema, taskStatusSchema } from "@/lib/contracts/task";

describe("tasks", () => {
  it("parses kinds and statuses", () => {
    expect(taskKindSchema.parse("slides")).toBe("slides");
    expect(taskStatusSchema.parse("approved")).toBe("approved");
  });

  it("rejects unknown values", () => {
    expect(taskKindSchema.safeParse("fax").success).toBe(false);
    expect(taskStatusSchema.safeParse("queued").success).toBe(false);
  });
});
