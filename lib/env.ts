import { z } from "zod";

const optionalEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  DATABASE_URL: optionalEnv,
  ANTHROPIC_API_KEY: optionalEnv,
  EXA_API_KEY: optionalEnv,
  NCBI_API_KEY: optionalEnv,
  AGENTMAIL_API_KEY: optionalEnv,
  AGENTMAIL_WEBHOOK_SECRET: optionalEnv,
  AGENTCALL_API_KEY: optionalEnv,
  AGENTCALL_WEBHOOK_SECRET: optionalEnv,
  AGENTCALL_FROM_NUMBER_ID: optionalEnv,
  VOICE_PROVIDER: optionalEnv,
  VAPI_API_KEY: optionalEnv,
  VAPI_PHONE_NUMBER_ID: optionalEnv,
  VAPI_WEBHOOK_SECRET: optionalEnv,
  VAPI_SERVER_URL: optionalEnv,
  OUTBOUND_ALLOW_REAL: optionalEnv,
  OUTBOUND_ALLOWLIST: optionalEnv,
  INNGEST_EVENT_KEY: optionalEnv,
  INNGEST_SIGNING_KEY: optionalEnv,
  WAYFINDER_OFFLINE: optionalEnv,
  WAYFINDER_APP_ORIGIN: optionalEnv,
  // --- task #38 (deploy readiness) additions: keep in this block to ease merges ---
  WAYFINDER_SESSION_SECRET: optionalEnv,
  WAYFINDER_MODE: optionalEnv,
  WAYFINDER_DEMO: optionalEnv,
  WAYFINDER_DEMO_STATE: optionalEnv,
  WAYFINDER_SIM_TIME_SCALE: optionalEnv,
  WAYFINDER_RECORD_LLM: optionalEnv,
  DEMO_REPLY_ALLOWLIST: optionalEnv,
  NEON_AI_GATEWAY_BASE_URL: optionalEnv,
  NEON_AI_GATEWAY_TOKEN: optionalEnv,
  // --- end task #38 additions ---
  // --- task #58 (web application channel) ---
  KERNEL_API_KEY: optionalEnv,
  OUTBOUND_WEB_ALLOWLIST: optionalEnv,
  // --- end task #58 ---
  // --- calendar lane: token sealing + optional Google Calendar OAuth ---
  WAYFINDER_TOKEN_KEY: optionalEnv,
  GOOGLE_CLIENT_ID: optionalEnv,
  GOOGLE_CLIENT_SECRET: optionalEnv,
  GOOGLE_REDIRECT_URI: optionalEnv,
  // --- end calendar lane ---
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}

export const env = parseEnv();

export function isOffline(value: string | undefined = env.WAYFINDER_OFFLINE): boolean {
  return value === "1" || value === "true";
}

// =====================================================================================
// Task #38: deploy-readiness validation. Importing this module never throws; validation
// only happens when assertEnv()/checkEnv() are called explicitly. Names only, never values.
// =====================================================================================

type EnvSource = Record<string, string | undefined>;

export type EnvMode = "offline" | "dev" | "demo" | "prod";

const MODES: readonly EnvMode[] = ["offline", "dev", "demo", "prod"];

const truthy = (v: string | undefined) => v === "1" || v === "true";
const isSet = (source: EnvSource, name: string) => (source[name] ?? "").trim() !== "";

/**
 * Mode resolution, first match wins:
 *   1. WAYFINDER_MODE is one of offline|dev|demo|prod          -> that mode
 *   2. WAYFINDER_OFFLINE is '1' or 'true'                      -> offline
 *   3. VERCEL_ENV === 'production'                             -> prod
 *   4. WAYFINDER_DEMO is '1' or 'true'                         -> demo (also Vercel preview + demo flag)
 *   5. NODE_ENV === 'production' and VERCEL_ENV is unset       -> prod
 *   6. otherwise (local dev, Vercel preview/development)       -> dev
 */
export function resolveMode(source: EnvSource = process.env): EnvMode {
  const explicit = (source.WAYFINDER_MODE ?? "").trim() as EnvMode;
  if (MODES.includes(explicit)) return explicit;
  if (truthy(source.WAYFINDER_OFFLINE)) return "offline";
  if (source.VERCEL_ENV === "production") return "prod";
  if (truthy(source.WAYFINDER_DEMO)) return "demo";
  if (source.NODE_ENV === "production" && !isSet(source, "VERCEL_ENV")) return "prod";
  return "dev";
}

export interface EnvRequirement {
  name: string;
  why: string;
  /** Satisfied if ANY entry is satisfied. An entry "A+B" means all of A and B must be set. */
  anyOf?: string[];
}

const GATEWAY_BASE = "NEON_AI_GATEWAY_BASE_URL";
const GATEWAY_TOKEN = "NEON_AI_GATEWAY_TOKEN";
const GATEWAY_PAIR = `${GATEWAY_BASE}+${GATEWAY_TOKEN}`;

const MODEL_ACCESS: EnvRequirement = {
  name: "MODEL_ACCESS",
  why: "LLM access: ANTHROPIC_API_KEY, or both Neon AI Gateway vars",
  anyOf: ["ANTHROPIC_API_KEY", GATEWAY_PAIR],
};

/** Env vars the deploy check reports on (set / unset), names only. */
export const TRACKED_ENV_NAMES: readonly string[] = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  GATEWAY_BASE,
  GATEWAY_TOKEN,
  "EXA_API_KEY",
  "NCBI_API_KEY",
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_WEBHOOK_SECRET",
  "AGENTCALL_API_KEY",
  "AGENTCALL_WEBHOOK_SECRET",
  "AGENTCALL_FROM_NUMBER_ID",
  "VOICE_PROVIDER",
  "VAPI_API_KEY",
  "VAPI_PHONE_NUMBER_ID",
  "VAPI_WEBHOOK_SECRET",
  "VAPI_SERVER_URL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "OUTBOUND_ALLOWLIST",
  "OUTBOUND_ALLOW_REAL",
  "DEMO_REPLY_ALLOWLIST",
  "AGENTMAIL_SENDER_INBOX_ID",
  "WAYFINDER_DEMO_COORDINATORS",
  "DEMO_COORDINATOR_INBOXES",
  "WAYFINDER_SESSION_SECRET",
  "WAYFINDER_MODE",
  "WAYFINDER_OFFLINE",
  "WAYFINDER_DEMO",
  "WAYFINDER_DEMO_STATE",
  "WAYFINDER_SIM_TIME_SCALE",
  "WAYFINDER_RECORD_LLM",
  "KERNEL_API_KEY",
  "OUTBOUND_WEB_ALLOWLIST",
];

function entrySatisfied(source: EnvSource, entry: string): boolean {
  return entry.split("+").every((n) => isSet(source, n));
}

export function requirementSatisfied(req: EnvRequirement, source: EnvSource = process.env): boolean {
  if (req.anyOf?.length) return req.anyOf.some((e) => entrySatisfied(source, e));
  return isSet(source, req.name);
}

export function requirementsFor(mode: EnvMode, source: EnvSource = process.env): EnvRequirement[] {
  if (mode === "offline" || mode === "dev") return [];

  const reqs: EnvRequirement[] = [
    { name: "DATABASE_URL", why: "Postgres (Neon) connection" },
    MODEL_ACCESS,
    { name: "WAYFINDER_SESSION_SECRET", why: "sign session cookies" },
  ];

  const allowReal = mode === "prod" && source.OUTBOUND_ALLOW_REAL === "true";
  if (!allowReal) {
    reqs.push({ name: "OUTBOUND_ALLOWLIST", why: "restrict real sends to approved recipients" });
  }

  if (mode === "prod") {
    reqs.push(
      { name: "AGENTMAIL_WEBHOOK_SECRET", why: "authenticate the public AgentMail webhook route" },
      { name: "AGENTCALL_WEBHOOK_SECRET", why: "authenticate the public AgentCall webhook route" },
      { name: "EXA_API_KEY", why: "web research source" },
    );
  } else {
    if (isSet(source, "AGENTMAIL_API_KEY")) {
      reqs.push({ name: "AGENTMAIL_WEBHOOK_SECRET", why: "AGENTMAIL_API_KEY is set; authenticate its webhook" });
    }
    if (isSet(source, "AGENTCALL_API_KEY")) {
      reqs.push({ name: "AGENTCALL_WEBHOOK_SECRET", why: "AGENTCALL_API_KEY is set; authenticate its webhook" });
    }
  }
  if (isSet(source, "AGENTCALL_API_KEY")) {
    reqs.push({ name: "AGENTCALL_FROM_NUMBER_ID", why: "AGENTCALL_API_KEY is set; caller number id" });
  }
  if (isSet(source, "VAPI_API_KEY") || source.VOICE_PROVIDER?.trim().toLowerCase() === "vapi") {
    reqs.push(
      { name: "VAPI_API_KEY", why: "Vapi voice provider selected; API key" },
      { name: "VAPI_PHONE_NUMBER_ID", why: "Vapi voice provider selected; caller phone number id" },
      { name: "VAPI_WEBHOOK_SECRET", why: "Vapi voice provider selected; authenticate its webhook" },
    );
  }
  return reqs;
}

export interface EnvReport {
  mode: EnvMode;
  ok: boolean;
  missing: EnvRequirement[];
  warnings: string[];
  /** Names of tracked vars that are set (never values). */
  set: string[];
  unset: string[];
}

export function inngestConfigured(source: EnvSource = process.env): boolean {
  return isSet(source, "INNGEST_EVENT_KEY") && isSet(source, "INNGEST_SIGNING_KEY");
}

/** Claude calls prefer the account's direct key when set; the gateway is used for them only without it. */
function modelAccess(source: EnvSource): "direct" | "gateway" | "none" {
  if (isSet(source, "ANTHROPIC_API_KEY")) return "direct";
  if (isSet(source, GATEWAY_BASE) && isSet(source, GATEWAY_TOKEN)) return "gateway";
  return "none";
}

export function checkEnv(mode?: EnvMode, source: EnvSource = process.env): EnvReport {
  const m = mode ?? resolveMode(source);
  const missing = requirementsFor(m, source).filter((r) => !requirementSatisfied(r, source));
  const warnings: string[] = [];

  if (m === "dev") {
    if (!isSet(source, "DATABASE_URL")) warnings.push("DATABASE_URL is not set (database features unavailable)");
    if (modelAccess(source) === "none") {
      warnings.push("No model access: set ANTHROPIC_API_KEY or both Neon AI Gateway vars");
    }
  }

  const allowReal = source.OUTBOUND_ALLOW_REAL;
  if (allowReal !== undefined && allowReal !== "" && allowReal !== "true") {
    warnings.push("OUTBOUND_ALLOW_REAL is set to a value other than 'true'; it is treated as off (typo?)");
  }
  if (allowReal === "true" && m !== "prod") {
    warnings.push(`OUTBOUND_ALLOW_REAL=true has no effect outside prod (mode: ${m})`);
  }
  if (isSet(source, GATEWAY_BASE) !== isSet(source, GATEWAY_TOKEN)) {
    warnings.push(`Only one of ${GATEWAY_BASE} / ${GATEWAY_TOKEN} is set; the gateway needs both`);
  }
  if (m === "prod" && isSet(source, "WAYFINDER_SIM_TIME_SCALE")) {
    warnings.push("WAYFINDER_SIM_TIME_SCALE is set in prod; simulated time should only be used for demos");
  }

  if ((m === "prod" || m === "demo") && !inngestConfigured(source) && !isSet(source, "CRON_SECRET")) {
    warnings.push(
      "Inngest is not configured (INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY): durable workflows and follow-ups are disabled and fail closed (nothing is sent)",
    );
  }

  const set = TRACKED_ENV_NAMES.filter((n) => isSet(source, n));
  const unset = TRACKED_ENV_NAMES.filter((n) => !isSet(source, n));
  return { mode: m, ok: missing.length === 0, missing, warnings, set, unset };
}

export class EnvValidationError extends Error {
  missing: string[];
  constructor(mode: EnvMode, missing: string[]) {
    super(`Missing required environment variables for ${mode}: ${missing.join(", ")} (see docs/DEPLOY.md)`);
    this.name = "EnvValidationError";
    this.missing = missing;
  }
}

export function assertEnv(mode?: EnvMode, source: EnvSource = process.env): EnvReport {
  const report = checkEnv(mode, source);
  if (!report.ok) throw new EnvValidationError(report.mode, report.missing.map((r) => r.name));
  return report;
}

export function deployStatus(source: EnvSource = process.env): {
  mode: EnvMode;
  gateway: "configured" | "not";
  inngest: "configured" | "unconfigured";
  outbound: "allowlist" | "real";
  modelAccess: "direct" | "gateway" | "none";
} {
  const mode = resolveMode(source);
  return {
    mode,
    gateway: isSet(source, GATEWAY_BASE) && isSet(source, GATEWAY_TOKEN) ? "configured" : "not",
    inngest: inngestConfigured(source) ? "configured" : "unconfigured",
    outbound: mode === "prod" && source.OUTBOUND_ALLOW_REAL === "true" ? "real" : "allowlist",
    modelAccess: modelAccess(source),
  };
}
