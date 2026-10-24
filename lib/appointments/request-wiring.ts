import { PostgresOutreachStore } from '../outreach/postgres-store';
import { selectChannels } from '../outreach/channel-wiring';
import { outboundAllowlist } from '../outreach/demo-destinations';
import type { ProviderRef } from '../outreach/types';
import { postgresRequestMessages, type RequestDeps } from './request';

/** Production RequestDeps: Postgres messages/contacts, the selected email channel, the same allowlist the gate uses. */
export function requestDeps(env: Record<string, string | undefined> = process.env): RequestDeps {
  const outreach = new PostgresOutreachStore();
  const email = selectChannels(env).channels.find(c => c.kind === 'email');
  return {
    ...postgresRequestMessages(),
    contact: id => outreach.contact(id),
    contacts: caseId => outreach.contacts(caseId),
    consent: id => outreach.consent(id),
    getCase: id => outreach.getCase(id),
    send: async (gated, thread) => {
      if (!email) throw new Error('Email channel unavailable');
      // AgentMail / the mock mailer accept a thread ref and reply inside the office's thread.
      const sender = email as unknown as { send(g: typeof gated, t?: NonNullable<typeof thread>): Promise<ProviderRef> };
      return sender.send(gated, thread ?? undefined);
    },
    env,
    allowlist: outboundAllowlist(env),
  };
}
