import { outreachHandlers } from './http';
import { PostgresOutreachStore } from './postgres-store';
import { PostgresFollowUpStore, selectChannels, WiredOutreachService } from './channel-wiring';
import { demoDestinationsEnabled } from './demo-destinations';
import type { SimulatedCallIngest } from './demo-call';
import { workflowSendEvents } from '../workflows/inline-events';
let handlers: ReturnType<typeof outreachHandlers> | undefined;

/** DEMO ONLY: simulated demo calls feed their scripted transcript through the normal AgentCall ingest steps. */
const simulatedCallIngest: SimulatedCallIngest = async (input) => {
  const [{ ingestSimulatedCallTranscript }, { postgresInboundDeps }] = await Promise.all([
    import('../../app/api/webhooks/_lib/inbound'), import('../../app/api/webhooks/_lib/postgres'),
  ]);
  await ingestSimulatedCallTranscript(postgresInboundDeps('agentcall'), input);
};

/**
 * Lazy DB initialization allows builds without database credentials. Channels are mock unless the provider
 * keys are present (see selectChannels); every send still passes checkOutbound and OUTBOUND_ALLOWLIST.
 * Without Inngest, workflow events run inline (follow-up timers are not scheduled; see inline-events).
 */
export function getOutreachHandlers() {
  return handlers ??= outreachHandlers(new WiredOutreachService(
    new PostgresOutreachStore(), selectChannels().channels, workflowSendEvents(), process.env, () => new Date(), new PostgresFollowUpStore(),
    demoDestinationsEnabled(process.env) ? simulatedCallIngest : undefined,
  ));
}
