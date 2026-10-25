import { z } from 'zod';
import { guardContact } from '@/lib/auth/ownership';
import { getOutreachService } from '@/lib/outreach/server';
import { startBrowserCall, webCallChannel } from '@/lib/outreach/browser-call';
import { vapiServerUrl } from '@/lib/outreach/channel-wiring';
import { PostgresCallLiveStore } from '@/lib/outreach/call-live';
import { outreachRespond } from '@/lib/outreach/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ draftId: z.uuid() }).strict();
const isJudge = (req: Request) => new URL(req.url).searchParams.get('view') === 'judge';

/**
 * DEMO ONLY. POST { draftId }: approves the drafted first call through the normal gate and starts it as a Vapi web
 * call the presenter answers in this browser. Returns only { callId, webCallUrl, publicKey, approvedAt }.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const denied = await guardContact(request, id);
  if (denied) return denied;
  return outreachRespond(async () => {
    const contactId = z.uuid().parse(id);
    const { draftId } = body.parse(await request.json());
    const serverUrl = vapiServerUrl(process.env);
    return startBrowserCall({
      service: getOutreachService(),
      channel: webCallChannel(process.env, serverUrl ? { serverUrl } : {}),
      live: new PostgresCallLiveStore(),
      env: process.env,
    }, contactId, draftId, { judge: isJudge(request) });
  });
}
