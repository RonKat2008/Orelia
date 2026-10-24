import { z } from 'zod';
import { SHARED_FIELDS } from './draft';
import { OutreachError } from './types';
import type { OutreachService } from './service';
const selection = z.object({ caseId: z.uuid(), candidateIds: z.array(z.uuid()).min(1).max(5).refine(ids => new Set(ids).size === ids.length, 'Duplicate candidate IDs') }).strict();
const consent = z.object({ sharedFields: z.array(z.enum(SHARED_FIELDS)).max(SHARED_FIELDS.length).refine(fields => new Set(fields).size === fields.length) }).strict();
const approval = z.object({ draftId: z.uuid() }).strict();
export function outreachHandlers(service: OutreachService) {
  async function respond(run: () => Promise<unknown>) {
    try { return Response.json(await run()); }
    catch (error) {
      if (error instanceof OutreachError) return Response.json({ reasons: error.reasons }, { status: error.status });
      if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ reasons: ['invalid_request'] }, { status: 400 });
      console.error('Outreach operation failed:', error instanceof Error ? error.name : 'unknown');
      return Response.json({ reasons: ['outreach_unavailable'] }, { status: 503 });
    }
  }
  const validId = (id: string) => z.uuid().parse(id);
  return {
    select: (req: Request) => respond(async () => { const body = selection.parse(await req.json()); return service.select(body.caseId, body.candidateIds); }),
    consent: (req: Request, id: string) => respond(async () => service.consent(validId(id), consent.parse(await req.json()).sharedFields)),
    draft: (_req: Request, id: string) => respond(async () => service.draft(validId(id))),
    approve: (req: Request, id: string) => respond(async () => service.approve(validId(id), approval.parse(await req.json()).draftId)),
  };
}
