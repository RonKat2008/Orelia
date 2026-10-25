/**
 * Live demo from a terminal, against a running deployment in demo mode (WAYFINDER_DEMO_COORDINATORS=1).
 *
 *   npx tsx scripts/demo-live.ts [--base https://wayfinder-amber-seven.vercel.app] [--approve] [--skip-ahead] [--watch 180]
 *
 * 1. POST /api/demo/live/start: synthetic vEDS case + four fictional resources, selected, consented, plan built.
 * 2. --approve: "Approve all" through the normal routes (plan, then each message/call, then the filled application).
 *    Every send still passes checkOutbound; this script never talks to a provider itself.
 * 3. --watch N: for N seconds, run the cron tick every 20 s (demo coordinator replies, follow-ups) and print new
 *    timeline events from /api/cases/[id]/activity. Approves the application once Kernel has filled it.
 * 4. --skip-ahead: after watching, simulate 3+ business days so the email-then-call resource's follow-up fires.
 * The session cookie lives only in this process. Prints the console URL to open in a browser (same session needed:
 * open it from the "Run full demo" button instead if you want to watch in the browser).
 */
import { approveAll, type FetchFn } from '../lib/demo-live/approve-all';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BASE = (arg('--base') ?? process.env.WAYFINDER_APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(): FetchFn {
  let cookie = '';
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', BASE);
    if (cookie) headers.set('cookie', cookie);
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = [cookie, ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
    return res;
  };
}

interface ActivityEvent { id: string; at: string; kind: string; title: string; detail?: string }

async function printNew(f: FetchFn, caseId: string, seen: Set<string>): Promise<void> {
  const res = await f(`/api/cases/${caseId}/activity`);
  if (!res.ok) return;
  const body = (await res.json()) as { events: ActivityEvent[] };
  for (const e of body.events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    console.log(`  ${e.at.slice(11, 19)}  ${e.kind.padEnd(22)} ${e.title}${e.detail ? ` — ${e.detail.slice(0, 90)}` : ''}`);
  }
}

async function tick(f: FetchFn, caseId: string, action: 'tick' | 'skip_ahead'): Promise<void> {
  const res = await f(`/api/cases/${caseId}/demo-live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
  const body = (await res.json().catch(() => ({}))) as { steps?: Record<string, unknown>; shifted?: unknown };
  console.log(`[${action}] ${res.status} ${JSON.stringify({ shifted: body.shifted ?? undefined, steps: body.steps })}`);
}

async function main(): Promise<void> {
  const f = client();
  console.log(`[demo-live] base ${BASE}`);
  const res = await f('/api/demo/live/start', { method: 'POST' });
  if (!res.ok) throw new Error(`start failed: HTTP ${res.status} (is demo mode on?)`);
  const started = (await res.json()) as { caseId: string; plan: { rules: string[] } | null; contacts: unknown[]; unavailable: unknown[] };
  console.log(`[demo-live] case ${started.caseId}: ${started.contacts.length} contacts, plan rules ${started.plan?.rules.join(', ') ?? 'none'}`);
  console.log(`[demo-live] console: ${BASE}/cases/${started.caseId}/live?view=judge`);

  if (process.argv.includes('--approve')) {
    for (const item of await approveAll(started.caseId, f)) console.log(`  ${item.ok ? 'OK ' : 'ERR'} ${item.kind} ${item.label}: ${item.detail}`);
  }
  const watch = Number(arg('--watch') ?? 0);
  const seen = new Set<string>();
  const until = Date.now() + watch * 1000;
  while (Date.now() < until) {
    await tick(f, started.caseId, 'tick');
    if (process.argv.includes('--approve')) {
      for (const item of await approveAll(started.caseId, f)) console.log(`  ${item.ok ? 'OK ' : 'ERR'} ${item.kind} ${item.label}: ${item.detail}`);
    }
    await printNew(f, started.caseId, seen);
    await sleep(20_000);
  }
  if (process.argv.includes('--skip-ahead')) {
    await tick(f, started.caseId, 'skip_ahead');
    await printNew(f, started.caseId, seen);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
