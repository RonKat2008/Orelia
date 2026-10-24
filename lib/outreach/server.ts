import { outreachHandlers } from './http';
import { MockChannel } from './mock-channel';
import { PostgresOutreachStore } from './postgres-store';
import { OutreachService } from './service';
let handlers: ReturnType<typeof outreachHandlers> | undefined;
/** Lazy DB initialization allows builds without database credentials. Default channels never access the network. */
export function getOutreachHandlers() {
  return handlers ??= outreachHandlers(new OutreachService(new PostgresOutreachStore(), [new MockChannel('email'), new MockChannel('voice')]));
}
