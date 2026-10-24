import { describe, expect, it } from "vitest";
import { casesToDelete, DEMO_CASE_ID, parseArgs } from "../../scripts/cleanup-smoke-cases";

const row = (id: string) => ({ id, disease: "vEDS", createdAt: "2026-10-24T00:00:00.000Z" });

describe("cleanup-smoke-cases", () => {
  it("always keeps the demo case and is a dry run by default", () => {
    expect(parseArgs([])).toEqual({ apply: false, keep: [DEMO_CASE_ID] });
    expect(parseArgs(["--apply"]).apply).toBe(true);
  });
  it("accepts extra --keep uuids and rejects garbage", () => {
    const other = "379de268-7f97-4164-8517-179cccc07e21";
    expect(parseArgs(["--keep", other]).keep).toEqual([DEMO_CASE_ID, other]);
    expect(() => parseArgs(["--keep", "nope"])).toThrow(/uuid/);
  });
  it("selects everything except the kept ids, case-insensitively", () => {
    const rows = [row(DEMO_CASE_ID), row("a0000000-0000-4000-8000-000000000001"), row("a0000000-0000-4000-8000-000000000002")];
    expect(casesToDelete(rows, [DEMO_CASE_ID.toUpperCase()]).map((r) => r.id)).toEqual(rows.slice(1).map((r) => r.id));
  });
});
