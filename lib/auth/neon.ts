import type { NeonAuth } from "@neondatabase/auth/next/server";

type Env = Record<string, string | undefined>;

/** Accounts exist only when Neon Auth is configured; anonymous use keeps working either way. */
export function accountsEnabled(env: Env = process.env): boolean {
  return Boolean(env.NEON_AUTH_BASE_URL && (env.NEON_AUTH_COOKIE_SECRET?.length ?? 0) >= 32 && env.WAYFINDER_OFFLINE !== "1");
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
