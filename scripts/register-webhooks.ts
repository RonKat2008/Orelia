/**
 * Register Orelia inbound webhooks. Default is dry-run (no POST/PATCH/DELETE).
 *
 *   npx tsx scripts/register-webhooks.ts --base-url https://example.com [--dry-run]
 *   npx tsx scripts/register-webhooks.ts --base-url https://example.com --apply
 *
 * --apply prints AGENTMAIL_WEBHOOK_SECRET and AGENTCALL_WEBHOOK_SECRET to stdout
 * when the provider returns them. It never writes secrets to disk.
 *
 * Vapi (VOICE_PROVIDER=vapi) needs no registration: every call Orelia places carries
 * assistant.server = { url: <base>/api/webhooks/vapi, headers: { x-vapi-secret: VAPI_WEBHOOK_SECRET } },
 * so set VAPI_WEBHOOK_SECRET (any long random value) in Vercel and the route authenticates it.
 * Optionally also set the same URL as the org Server URL in the Vapi dashboard with a Bearer Token credential
 * (header x-vapi-secret, no Bearer prefix, same secret). See docs/VOICE-PROVIDER.md and vapiWebhookNote().
 */
import { planRegistration, vapiWebhookNote, type WebhookRecord, MAIL_EVENTS, CALL_EVENTS } from './register-webhooks-plan';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baseUrl = arg('--base-url')?.replace(/\/+$/, '');
const apply = process.argv.includes('--apply');
const dryRun = !apply || process.argv.includes('--dry-run');

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  console.error('Usage: npx tsx scripts/register-webhooks.ts --base-url https://<host> [--dry-run | --apply]');
  process.exit(1);
}

const mailKey = process.env.AGENTMAIL_API_KEY;
const callKey = process.env.AGENTCALL_API_KEY;
if (!mailKey || !callKey) {
  console.error('AGENTMAIL_API_KEY and AGENTCALL_API_KEY must be set (dry-run still lists existing webhooks).');
  process.exit(1);
}

async function api(url: string, key: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) as unknown : {};
  if (!res.ok) throw new Error(`HTTP ${res.status} ${init?.method ?? 'GET'} ${new URL(url).pathname}`);
  return body;
}

async function listMail(): Promise<WebhookRecord[]> {
  const rows: WebhookRecord[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({ limit: '100' });
    if (page) q.set('page_token', page);
    const body = await api(`https://api.agentmail.to/v0/webhooks?${q}`, mailKey!) as { webhooks?: WebhookRecord[]; next_page_token?: string };
    rows.push(...(body.webhooks ?? []));
    page = body.next_page_token;
  } while (page);
  return rows;
}

async function listCall(): Promise<WebhookRecord[]> {
  const body = await api('https://api.agentcall.co/v1/webhooks', callKey!) as { data?: WebhookRecord[] };
  return body.data ?? [];
}

function printSecret(name: string, secret: unknown) {
  if (dryRun) {
    console.log(`${name}=<not printed in dry-run>`);
    return;
  }
  if (typeof secret === 'string' && secret) console.log(`${name}=${secret}`);
  else console.log(`${name}=<not returned; list/create did not include a secret>`);
}

async function main() {
  const mailUrl = `${baseUrl}/api/webhooks/agentmail`;
  const callUrl = `${baseUrl}/api/webhooks/agentcall`;
  const mailPlan = planRegistration({ provider: 'agentmail', url: mailUrl, events: MAIL_EVENTS, existing: await listMail() });
  const callPlan = planRegistration({ provider: 'agentcall', url: callUrl, events: CALL_EVENTS, existing: await listCall() });

  console.log(dryRun ? 'dry-run' : 'apply');
  console.log(vapiWebhookNote(baseUrl!));
  for (const plan of [mailPlan, callPlan]) {
    console.log(`${plan.provider}: ${plan.action} ${plan.url} events=${plan.events.join(',')}${plan.note ? ` (${plan.note})` : ''}`);
  }
  if (dryRun) {
    console.log('AGENTMAIL_WEBHOOK_SECRET=<set from the create/update response when you pass --apply>');
    console.log('AGENTCALL_WEBHOOK_SECRET=<set from the create response when you pass --apply>');
    return;
  }

  let mailSecret: unknown;
  if (mailPlan.action === 'create') {
    const created = await api('https://api.agentmail.to/v0/webhooks', mailKey!, { method: 'POST', body: JSON.stringify({ url: mailUrl, event_types: MAIL_EVENTS, client_id: 'wayfinder-agentmail-webhook' }) }) as { secret?: string };
    mailSecret = created.secret;
  } else if (mailPlan.action === 'update' && mailPlan.id) {
    const updated = await api(`https://api.agentmail.to/v0/webhooks/${encodeURIComponent(mailPlan.id)}`, mailKey!, { method: 'PATCH', body: JSON.stringify({ event_types: MAIL_EVENTS, enabled: true }) }) as { secret?: string };
    mailSecret = updated.secret;
  } else mailSecret = mailPlan.secret;
  printSecret('AGENTMAIL_WEBHOOK_SECRET', mailSecret);

  let callSecret: unknown;
  if (callPlan.action === 'replace' && callPlan.id) {
    await api(`https://api.agentcall.co/v1/webhooks/${encodeURIComponent(callPlan.id)}`, callKey!, { method: 'DELETE' });
  }
  if (callPlan.action === 'create' || callPlan.action === 'replace') {
    const created = await api('https://api.agentcall.co/v1/webhooks', callKey!, { method: 'POST', body: JSON.stringify({ url: callUrl, events: CALL_EVENTS }) }) as { secret?: string };
    callSecret = created.secret;
  } else callSecret = callPlan.secret;
  printSecret('AGENTCALL_WEBHOOK_SECRET', callSecret);
}

main().catch(err => {
  const msg = String((err as Error)?.message ?? err);
  console.error(msg.split(mailKey).join('[redacted]').split(callKey).join('[redacted]'));
  process.exit(1);
});
