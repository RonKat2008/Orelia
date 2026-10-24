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
  OUTBOUND_ALLOWLIST: optionalEnv,
  INNGEST_EVENT_KEY: optionalEnv,
  INNGEST_SIGNING_KEY: optionalEnv,
  WAYFINDER_OFFLINE: optionalEnv,
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(source);
}

export const env = parseEnv();

export function isOffline(value: string | undefined = env.WAYFINDER_OFFLINE): boolean {
  return value === "1" || value === "true";
}
