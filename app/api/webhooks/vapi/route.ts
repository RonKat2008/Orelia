import { PostgresCallLiveStore } from '../../../../lib/outreach/call-live';
import { postgresInboundDeps } from '../_lib/postgres';
import { handleVapiWebhook } from '../_lib/vapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vapi server messages (status-update, final transcript turns, end-of-call-report). See docs/VOICE-PROVIDER.md. */
export async function POST(req: Request) {
  return handleVapiWebhook(req, { ...postgresInboundDeps('vapi'), live: new PostgresCallLiveStore() });
}
