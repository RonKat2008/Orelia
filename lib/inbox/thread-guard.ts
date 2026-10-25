export interface InboxEvent {
  channel: 'email' | 'voice';
  providerThreadId?: string;
  providerCallId?: string;
  from?: string;
  subject?: string;
  /** Stored messages.id (uuid) of the inbound reply. */
  messageId?: string;
  body: string;
  receivedAt: string;
  /** Fixture stem under fixtures/llm/inbox/ for offline replay. */
  offlineKey?: string;
  /** Idempotency key stored on the tasks this event creates (see tasks.source_id). */
  sourceId?: string;
}
export type ThreadKey = Pick<InboxEvent, 'providerThreadId' | 'providerCallId'>;
export type ThreadLookup = (key: ThreadKey) => string | undefined | Promise<string | undefined>;
export class InboxRejected extends Error {
  constructor(readonly reason: 'no_thread_id' | 'unknown_thread', message: string) {
    super(message);
    this.name = 'InboxRejected';
  }
}
/** Only replies on a thread/call Orelia stored are processed; nothing is classified otherwise. */
export async function assertWayfinderThread(event: InboxEvent, lookup: ThreadLookup): Promise<string> {
  if (!event.providerThreadId && !event.providerCallId) throw new InboxRejected('no_thread_id', 'Inbound event has no provider thread or call id');
  const contactId = await lookup({ providerThreadId: event.providerThreadId, providerCallId: event.providerCallId });
  if (!contactId) throw new InboxRejected('unknown_thread', 'Inbound event is not on a stored Orelia thread');
  return contactId;
}
