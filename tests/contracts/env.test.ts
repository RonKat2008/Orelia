import { describe, expect, it } from "vitest";
import { isOffline, parseEnv } from "@/lib/env";

describe("env", () => {
  it("treats every variable as optional", () => {
    expect(parseEnv({}).DATABASE_URL).toBeUndefined();
  });

  it("turns blank values into undefined and reads offline mode", () => {
    expect(parseEnv({ DATABASE_URL: "", WAYFINDER_OFFLINE: "1" }).DATABASE_URL).toBeUndefined();
    expect(isOffline("1")).toBe(true);
    expect(isOffline("true")).toBe(true);
    expect(isOffline(undefined)).toBe(false);
  });
});
