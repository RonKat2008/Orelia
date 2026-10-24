import { outreachHandlers } from './http';
import { PostgresOutreachStore } from './postgres-store';
import { PostgresFollowUpStore, selectChannels, WiredOutreachService } from './channel-wiring';
import { inngestSendEvents } from '../workflows/events';
let handlers: ReturnType<typeof outreachHandlers> | undefined;
/**
 * Lazy DB initialization allows builds without database credentials. Channels are mock unless the provider
 * keys are present (see selectChannels); every send still passes checkOutbound and OUTBOUND_ALLOWLIST.
 */
export function getOutreachHandlers() {
  return handlers ??= outreachHandlers(new WiredOutreachService(
    new PostgresOutreachStore(), selectChannels().channels, inngestSendEvents(), process.env, () => new Date(), new PostgresFollowUpStore(),
  ));
}
