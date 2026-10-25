type AuthAction = "sign-in" | "sign-up" | "forgot-password" | "reset-password" | "google";

const DEFAULT_MESSAGES: Record<AuthAction, string> = {
  "sign-in": "We could not sign you in right now. Please try again.",
  "sign-up": "We could not create your account right now. Please try again.",
  "forgot-password": "We could not send the reset email right now. Please try again.",
  "reset-password": "We could not update your password right now. Please try again.",
  google: "Google sign-in is not available right now. Please try again.",
};

/** Handles both returned Better Auth errors and thrown Neon AuthApiError/AuthError values. */
export function authErrorMessage(error: unknown, action: AuthAction): string {
  const details = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; name?: unknown } : {};
  const code = typeof details.code === "string" ? details.code.toLowerCase() : "";
  const status = typeof details.status === "number" ? details.status : 0;
  if (status === 429 || code.includes("rate_limit")) return "Too many attempts. Please wait a few minutes and try again.";
  if (["email_not_verified", "email_not_confirmed"].includes(code)) return "Verify your email using the link in your inbox, then sign in.";
  if (action === "sign-in" && (status === 401 || ["invalid_email_or_password", "invalid_password", "invalid_credentials", "user_not_found", "identity_not_found"].includes(code))) {
    return "The email or password is incorrect. Check both and try again.";
  }
  if (action === "sign-up" && (status === 409 || ["user_already_exists", "email_exists"].includes(code))) {
    return "An account with this email already exists. Sign in or reset your password.";
  }
  if (["weak_password", "password_too_short", "password_too_long"].includes(code)) return "That password does not meet the requirements. Try a different password.";
  if (["invalid_email", "email_address_invalid"].includes(code)) return "Enter a valid email address.";
  if (action === "reset-password" && (status === 401 || ["invalid_token", "bad_jwt", "token_expired", "session_expired"].includes(code))) {
    return "That reset link is invalid or has expired. Request a new one.";
  }
  if (details.name === "TypeError" || details.name === "AuthRetryableFetchError") {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  // Never show arbitrary provider messages, which can contain internal details.
  return DEFAULT_MESSAGES[action];
}
