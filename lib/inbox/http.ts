import { z } from 'zod';
import { OutreachError } from '../outreach/types';
import { normalizeAddress } from '../safety/allowlist';
import { approveTask, type ApproveDeps } from './approve';

export function inboxHandlers(deps: ApproveDeps) {
  async function respond(run: () => Promise<unknown>) {
    try { return Response.json(await run()); }
    catch (error) {
      if (error instanceof OutreachError) return Response.json({ reasons: error.reasons }, { status: error.status });
      if (error instanceof z.ZodError) return Response.json({ reasons: ['invalid_request'] }, { status: 400 });
      console.error('Task operation failed:', error instanceof Error ? error.name : 'unknown');
      return Response.json({ reasons: ['tasks_unavailable'] }, { status: 503 });
    }
  }
  const approveBody = z.object({ confirmAddress: z.string().max(320).optional() });
  const validId = (id: string) => z.uuid().parse(id);
  return {
    approve: (req: Request, id: string) => respond(async () => {
      const taskId = validId(id);
      const raw = await req.text();
      let json: unknown = {};
      if (raw.trim()) { try { json = JSON.parse(raw); } catch { throw new z.ZodError([]); } }
      return approveTask(taskId, deps, approveBody.parse(json ?? {}));
    }),
    get: (_req: Request, id: string) => respond(async () => {
      const task = await deps.tasks.task(validId(id));
      if (!task) throw new OutreachError(404, ['task_not_found']);
      if (task.kind !== 'redirect') return { task };
      const r = (task.details?.redirect ?? {}) as { email?: string };
      return { task, confirm: { address: r.email ? normalizeAddress(r.email) : null, quote: task.details?.quote ?? null } };
    }),
  };
}
