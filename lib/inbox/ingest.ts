import { processInbound, type InboxDeps } from '../agents/inbox';
import type { InboxEvent } from './thread-guard';
import type { TaskStore } from './task-store';

/** Classify an inbound reply and persist the resulting draft tasks (status open; nothing is sent). */
export async function ingestInbound(event: InboxEvent, deps: InboxDeps & { tasks: TaskStore }) {
  const result = await processInbound(event, deps);
  const tasks = await deps.tasks.saveTasks(result.tasks);
  return { ...result, tasks };
}
