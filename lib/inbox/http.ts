import { z } from 'zod';
import { OutreachError } from '../outreach/types';
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
  const validId = (id: string) => z.uuid().parse(id);
  return {
    approve: (_req: Request, id: string) => respond(() => approveTask(validId(id), deps)),
    get: (_req: Request, id: string) => respond(async () => {
      const task = await deps.tasks.task(validId(id));
      if (!task) throw new OutreachError(404, ['task_not_found']);
      return { task };
    }),
  };
}
