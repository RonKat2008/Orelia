import { outreachHandlers } from './http';
import { PostgresOutreachStore } from './postgres-store';
import { PostgresFollowUpStore, selectChannels, WiredOutreachService } from './channel-wiring';
import { workflowSendEvents } from '../workflows/inline-events';
let handlers: ReturnType<typeof outreachHandlers> | undefined;
/**
 * Lazy DB initialization allows builds without database credentials. Channels are mock unless the provider
 * keys are present (see selectChannels); every send still passes checkOutbound and OUTBOUND_ALLOWLIST.
 * Without Inngest, workflow events run inline (follow-up timers are not scheduled; see inline-events).
 */
export function getOutreachHandlers() {
  return handlers ??= outreachHandlers(new WiredOutreachService(
    new PostgresOutreachStore(), selectChannels().channels, workflowSendEvents(), process.env, () => new Date(), new PostgresFollowUpStore(),
  ));
}
