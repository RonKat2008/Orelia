import { PostgresOutreachStore } from '../outreach/postgres-store';
import { inboxHandlers } from './http';
import { PostgresInboundMessageStore } from './inbound-store';
import { PostgresTaskStore } from './task-store';

let handlers: ReturnType<typeof inboxHandlers> | undefined;
/** Lazy DB initialization allows builds without database credentials. */
export function getInboxHandlers() {
  return handlers ??= inboxHandlers({ tasks: new PostgresTaskStore(), outreach: new PostgresOutreachStore(), inbound: new PostgresInboundMessageStore() });
}
