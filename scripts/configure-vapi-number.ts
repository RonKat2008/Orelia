/**
 * Point the Vapi phone number's server URL at Orelia's webhook (fallback for calls without an inline server).
 * Default is dry-run (GET only). Never prints the API key or the webhook secret.
 *
 *   npx tsx scripts/configure-vapi-number.ts --base-url https://wayfinder-amber-seven.vercel.app [--apply]
 *
 * Needs VAPI_API_KEY, VAPI_PHONE_NUMBER_ID and VAPI_WEBHOOK_SECRET (loaded from .env.local via dotenv).
 * Sets server = { url: <base>/api/webhooks/vapi, headers: { x-vapi-secret: VAPI_WEBHOOK_SECRET } }.
 */
import { config } from 'dotenv';
import { VAPI_BASE_URL, VAPI_SECRET_HEADER } from '../lib/channels/vapi';
import { vapiWebhookNote } from './register-webhooks-plan';

config({ path: '.env.local', quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baseUrl = arg('--base-url')?.replace(/\/+$/, '');
const apply = process.argv.includes('--apply');
const key = process.env.VAPI_API_KEY?.trim();
const numberId = process.env.VAPI_PHONE_NUMBER_ID?.trim();
const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();

function redact(text: string): string {
  return [key, secret].reduce<string>((out, s) => (s ? out.split(s).join('[redacted]') : out), text);
}

async function api(method: 'GET' | 'PATCH', body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${VAPI_BASE_URL}/phone-number/${encodeURIComponent(numberId!)}`, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${method} /phone-number: ${redact(text).slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function describe(n: Record<string, unknown>): string {
  const server = n.server as { url?: string; headers?: Record<string, string> } | undefined;
  return JSON.stringify({
    id: n.id, provider: n.provider, number: n.number, status: n.status, assistantId: n.assistantId ?? null,
    serverUrl: server?.url ?? null, serverSecretHeaderSet: !!server?.headers?.[VAPI_SECRET_HEADER],
  });
}

async function main() {
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) throw new Error('Usage: --base-url https://<host> [--apply]');
  if (!key || !numberId || !secret) throw new Error('VAPI_API_KEY, VAPI_PHONE_NUMBER_ID and VAPI_WEBHOOK_SECRET must be set');
  const before = await api('GET');
  console.log(`before: ${describe(before)}`);
  console.log(vapiWebhookNote(baseUrl));
  if (!apply) { console.log('dry-run: pass --apply to PATCH the number'); return; }
  const after = await api('PATCH', {
    provider: before.provider,
    server: { url: `${baseUrl}/api/webhooks/vapi`, headers: { [VAPI_SECRET_HEADER]: secret }, timeoutSeconds: 20 },
  });
  console.log(`after: ${describe(after)}`);
}

main().catch(err => { console.error(redact(String((err as Error)?.message ?? err))); process.exit(1); });
