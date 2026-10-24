const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Env = Record<string, string | undefined>;

function originOf(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function first(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function expectedOrigins(req: Request, env: Env): string[] {
  if (env.WAYFINDER_APP_ORIGIN) {
    const configured = originOf(env.WAYFINDER_APP_ORIGIN);
    return configured ? [configured] : [];
  }
  const out: string[] = [];
  const reqUrl = originOf(req.url);
  if (reqUrl) out.push(reqUrl);
  const host = first(req.headers.get("x-forwarded-host"));
  if (host) {
    const proto = first(req.headers.get("x-forwarded-proto")) ?? (reqUrl ? new URL(reqUrl).protocol.slice(0, -1) : "https");
    const forwarded = originOf(`${proto}://${host}`);
    if (forwarded) out.push(forwarded);
  }
  return out;
}

/** CSRF defence: state-changing requests must carry an Origin (or Referer) matching the app origin. */
export function isSameOrigin(req: Request, env: Env = process.env): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
  const origin = originOf(req.headers.get("origin")) ?? originOf(req.headers.get("referer"));
  if (!origin) return false;
  return expectedOrigins(req, env).includes(origin);
}

export function rejectCrossOrigin(req: Request, env: Env = process.env): Response | null {
  return isSameOrigin(req, env) ? null : Response.json({ error: "Forbidden" }, { status: 403 });
}
