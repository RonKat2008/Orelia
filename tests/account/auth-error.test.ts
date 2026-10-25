import { describe, expect, it } from "vitest";
import { AuthApiError, AuthError } from "@neondatabase/auth/next";
import { authErrorMessage } from "@/components/account/auth/auth-error";

describe("auth error messages", () => {
  it("recognizes the installed SDK's thrown credential error", () => {
    const error = new AuthApiError("Invalid email or password", 401, "invalid_credentials");
    expect(authErrorMessage(error, "sign-in")).toMatch(/email or password is incorrect/);
  });
  it("handles returned provider errors and normalized codes", () => {
    expect(authErrorMessage({ code: "EMAIL_NOT_VERIFIED", status: 403 }, "sign-in")).toMatch(/Verify your email/);
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS", status: 409 }, "sign-up")).toMatch(/already exists/);
    expect(authErrorMessage({ status: 429 }, "sign-in")).toMatch(/Too many attempts/);
    expect(authErrorMessage({ code: "bad_jwt", status: 401 }, "reset-password")).toMatch(/expired/);
    expect(authErrorMessage({ code: "weak_password" }, "sign-up")).toMatch(/requirements/);
  });
  it("distinguishes connection failures from server failures without exposing details", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"), "sign-in")).toMatch(/connection/);
    const error = new AuthError("private internal provider trace", 500, "unexpected_failure");
    expect(authErrorMessage(error, "sign-in")).toBe("We could not sign you in right now. Please try again.");
    expect(authErrorMessage({ message: "private trace" }, "forgot-password")).not.toContain("private");
  });
});
