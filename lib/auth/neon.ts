import type { NeonAuth } from "@neondatabase/auth/next/server";

type Env = Record<string, string | undefined>;

/** Account access can be enabled independently of fixture-based research. */
export function accountsEnabled(env: Env = process.env): boolean {
  const setting = env.WAYFINDER_ACCOUNTS_ENABLED?.trim().toLowerCase();
  if (setting === "false" || setting === "0") return false;
  const offline = ["1", "true"].includes((env.WAYFINDER_OFFLINE ?? "").trim().toLowerCase());
  const explicitlyEnabled = setting === "true" || setting === "1";
  return Boolean(env.NEON_AUTH_BASE_URL?.trim() && (env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= 32 && (!offline || explicitlyEnabled));
}

let instance: Promise<NeonAuth> | undefined;

/** Lazily created Neon Auth server instance (handler, getSession, signOut, deleteUser...). */
export function getNeonAuth(env: Env = process.env): Promise<NeonAuth> {
  if (!accountsEnabled(env)) return Promise.reject(new Error("Accounts are not configured"));
  instance ??= import("@neondatabase/auth/next/server").then(({ createNeonAuth }) => createNeonAuth({
    baseUrl: env.NEON_AUTH_BASE_URL!,
    cookies: { secret: env.NEON_AUTH_COOKIE_SECRET!, sameSite: "lax" },
    logLevel: "warn",
  }));
  return instance;
}
