import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "wf_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type Env = Record<string, string | undefined>;

let devSecret: string | undefined;
let warned = false;

function secret(env: Env): string {
  const configured = env.WAYFINDER_SESSION_SECRET;
  if (configured) return configured;
  if (env.NODE_ENV === "production") throw new Error("WAYFINDER_SESSION_SECRET is required in production");
  if (!warned) {
    warned = true;
    console.warn("[auth] WAYFINDER_SESSION_SECRET is not set; using a per-process random secret (sessions reset on restart).");
  }
  devSecret ??= randomBytes(32).toString("base64url");
  return devSecret;
}

function sign(id: string, key: string): string {
  return createHmac("sha256", key).update(id).digest("base64url");
}

export function signSession(id: string, env: Env = process.env): string {
  return `${id}.${sign(id, secret(env))}`;
}

export function verifySessionValue(value: string, env: Env = process.env): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret(env)));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

function cookieValue(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function readSession(req: Request, env: Env = process.env): string | null {
  const value = cookieValue(req);
  return value ? verifySessionValue(value, env) : null;
}

export function sessionCookie(id: string, env: Env = process.env): string {
  const parts = [
    `${SESSION_COOKIE}=${signSession(id, env)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function ensureSession(req: Request, env: Env = process.env): { id: string; setCookie?: string } {
  const existing = readSession(req, env);
  if (existing) return { id: existing };
  const id = randomBytes(32).toString("base64url");
  return { id, setCookie: sessionCookie(id, env) };
}
