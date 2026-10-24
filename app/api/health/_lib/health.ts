import { checkEnv, deployStatus, resolveMode } from "@/lib/env";
import { followUpScheduler, type FollowUpScheduler } from "@/lib/workflows/scheduler";

type Source = Record<string, string | undefined>;

export interface HealthDeps {
  source: Source;
  pingDb: () => Promise<void>;
  timeoutMs?: number;
}

export type DbStatus = "up" | "down" | "not_configured";

export interface HealthReport {
  ok: boolean;
  /** "ok", "degraded" (no follow-up scheduler: neither Inngest nor cron; still serving) or "down". */
  status: "ok" | "degraded" | "down";
  mode: string;
  db: DbStatus;
  gateway: string;
  modelAccess: string;
  inngest: string;
  /** Active follow-up scheduler: inngest, cron (Vercel Cron + CRON_SECRET) or none. */
  scheduler: FollowUpScheduler;
  outbound: string;
  env: { ok: boolean; missing: string[] };
  version?: string;
}

const DEFAULT_TIMEOUT_MS = 1500;

async function checkDb(deps: HealthDeps): Promise<DbStatus> {
  if (!deps.source.DATABASE_URL) return "not_configured";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    });
    await Promise.race([deps.pingDb(), timeout]);
    return "up";
  } catch {
    // Never surface the error: it can contain the connection string.
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/** Builds the health payload. Names and statuses only; never an env value or error text. */
export async function healthReport(deps: HealthDeps): Promise<HealthReport> {
  const mode = resolveMode(deps.source);
  const envCheck = checkEnv(mode, deps.source);
  const status = deployStatus(deps.source);
  const db = await checkDb(deps);
  const scheduler = followUpScheduler(deps.source);
  const sha = deps.source.VERCEL_GIT_COMMIT_SHA;
  const ok = db !== "down" && envCheck.ok;
  return {
    ok,
    status: !ok ? "down" : scheduler === "none" && envCheck.mode !== "offline" && envCheck.mode !== "dev" ? "degraded" : "ok",
    mode: envCheck.mode,
    db,
    gateway: status.gateway,
    modelAccess: status.modelAccess,
    inngest: status.inngest,
    scheduler,
    outbound: status.outbound,
    env: { ok: envCheck.ok, missing: envCheck.missing.map((m) => m.name) },
    ...(sha ? { version: sha.slice(0, 7) } : {}),
  };
}
