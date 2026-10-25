import { describe, expect, it } from "vitest";
import { accountsEnabled } from "@/lib/auth/neon";

const configured = { NEON_AUTH_BASE_URL: "https://auth.example.test/neondb/auth", NEON_AUTH_COOKIE_SECRET: "a".repeat(48) };

describe("account configuration", () => {
  it("requires configured auth credentials", () => {
    expect(accountsEnabled({})).toBe(false);
    expect(accountsEnabled({ ...configured, NEON_AUTH_COOKIE_SECRET: "short" })).toBe(false);
    expect(accountsEnabled(configured)).toBe(true);
  });
  it.each(["1", "true", " TRUE "])("keeps ordinary offline runs isolated (%s)", (value) => {
    expect(accountsEnabled({ ...configured, WAYFINDER_OFFLINE: value })).toBe(false);
  });
  it("allows account signup while research uses fixtures when explicitly enabled", () => {
    expect(accountsEnabled({ ...configured, WAYFINDER_OFFLINE: "1", WAYFINDER_ACCOUNTS_ENABLED: "true" })).toBe(true);
    expect(accountsEnabled({ ...configured, WAYFINDER_OFFLINE: "true", WAYFINDER_ACCOUNTS_ENABLED: "1" })).toBe(true);
  });
  it("supports explicit shutdown even when credentials are configured", () => {
    expect(accountsEnabled({ ...configured, WAYFINDER_ACCOUNTS_ENABLED: "false" })).toBe(false);
  });
});
