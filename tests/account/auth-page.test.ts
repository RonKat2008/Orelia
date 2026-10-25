import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { accountsEnabled } from "@/lib/auth/neon";
import { AuthPage } from "@/components/account/auth/AuthPage";

vi.mock("@/lib/auth/neon", () => ({ accountsEnabled: vi.fn() }));
vi.mock("@/components/shell", () => ({ SiteHeader: () => null, SiteFooter: () => null }));

describe("auth availability", () => {
  it("replaces active forms with an anonymous start link when accounts are unavailable", () => {
    vi.mocked(accountsEnabled).mockReturnValue(false);
    const html = renderToStaticMarkup(React.createElement(AuthPage, null, React.createElement("form", { "data-auth-form": true })));
    expect(html).toContain("Accounts are unavailable");
    expect(html).toContain('href="/start"');
    expect(html).not.toContain("data-auth-form");
  });

  it("renders the requested auth form when accounts are enabled", () => {
    vi.mocked(accountsEnabled).mockReturnValue(true);
    const html = renderToStaticMarkup(React.createElement(AuthPage, null, React.createElement("form", { "data-auth-form": true })));
    expect(html).toContain("data-auth-form");
    expect(html).not.toContain("Accounts are unavailable");
  });
});
