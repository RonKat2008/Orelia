import { z } from 'zod';
import { SHARED_FIELDS } from './draft';
import { ChannelError, isDefiniteNonDelivery } from '../channels/types';
import { OutreachError } from './types';
import type { OutreachService } from './service';
const selection = z.object({ caseId: z.uuid(), candidateIds: z.array(z.uuid()).min(1).max(5).refine(ids => new Set(ids).size === ids.length, 'Duplicate candidate IDs') }).strict();
const consent = z.object({ sharedFields: z.array(z.enum(SHARED_FIELDS)).max(SHARED_FIELDS.length).refine(fields => new Set(fields).size === fields.length) }).strict();
const approval = z.object({ draftId: z.uuid() }).strict();
const DETAIL_MAX = 300;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/**
 * What the provider said, in one short line the patient can act on: "<provider>: HTTP 403 plan_limit_outbound.
 * Outbound calls need a paid plan. Upgrade: https://..." Only plain string fields of the error body are used (code,
 * message/error, upgradeUrl); our own key never appears in a provider body. Without a body, just the status.
 */
export function providerDetail(error: ChannelError): string | undefined {
  const body = error.body && typeof error.body === 'object' ? error.body as Record<string, unknown> : undefined;
  const code = str(body?.code);
  const message = str(body?.message) ?? str(body?.error) ?? (typeof body?.error === 'object' && body.error ? str((body.error as Record<string, unknown>).message) : undefined);
  const upgradeUrl = str(body?.upgradeUrl);
  const parts = [`${error.provider}: ${error.status ? `HTTP ${error.status}` : 'no response'}${code ? ` ${code}` : ''}`];
  if (message && message !== code) parts.push(message);
  if (upgradeUrl && /^https:\/\//.test(upgradeUrl)) parts.push(`Upgrade: ${upgradeUrl}`);
  const detail = parts.join('. ');
  return error.status || body ? detail.slice(0, DETAIL_MAX) : undefined;
}

/** Runs one outreach operation and maps its errors to the API's { reasons, detail } responses. */
export async function outreachRespond(run: () => Promise<unknown>): Promise<Response> {
  try { return Response.json(await run()); }
  catch (error) {
    if (error instanceof OutreachError) return Response.json({ reasons: error.reasons }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ reasons: ['invalid_request'] }, { status: 400 });
    // The provider answered or timed out while sending. A 4xx means it rejected the message (undone, retry is fine);
    // anything else is ambiguous: it stays reserved, will not be retried automatically, and the patient must check.
    if (error instanceof ChannelError) {
      const detail = providerDetail(error);
      console.error('Outreach send failed:', error.name, error.status ?? 'no-status', detail ?? '');
      return isDefiniteNonDelivery(error)
        ? Response.json({ reasons: ['send_rejected'], ...(detail ? { detail } : {}) }, { status: 502 })
        : Response.json({ reasons: ['send_status_unknown'], ...(detail ? { detail } : {}) }, { status: 502 });
    }
    console.error('Outreach operation failed:', error instanceof Error ? error.name : 'unknown');
    return Response.json({ reasons: ['outreach_unavailable'] }, { status: 503 });
  }
}

export function outreachHandlers(service: OutreachService) {
  const respond = outreachRespond;
  const validId = (id: string) => z.uuid().parse(id);
  return {
    select: (req: Request) => respond(async () => { const body = selection.parse(await req.json()); return service.select(body.caseId, body.candidateIds); }),
    consent: (req: Request, id: string) => respond(async () => service.consent(validId(id), consent.parse(await req.json()).sharedFields)),
    draft: (_req: Request, id: string) => respond(async () => service.draft(validId(id))),
    approve: (req: Request, id: string) => respond(async () => service.approve(validId(id), approval.parse(await req.json()).draftId)),
  };
}
