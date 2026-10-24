import { assertGated, type Channel, type ChannelGuardOptions, type GatedDraft, type OutboundThreadRef, type ProviderRef } from './types';

export interface MockEmail {
  readonly to: string;
  readonly subject?: string;
  readonly body: string;
  readonly approvedAt: string;
  readonly contactId?: string;
  readonly caseId?: string;
  readonly ref: ProviderRef;
  readonly sentAt: string;
}

/** In-memory mailer for tests and the offline demo; nothing leaves the process. */
export class MockMailer implements Channel {
  readonly kind = 'email' as const;
  readonly sent: MockEmail[] = [];
  private seq = 0;
  constructor(private guard: ChannelGuardOptions, private now = () => new Date()) {}

  async send(gated: GatedDraft, thread?: OutboundThreadRef): Promise<ProviderRef> {
    const to = assertGated(gated, 'email', 'mock-mailer', this.guard);
    const n = ++this.seq;
    // Follow-ups to the same contact share a thread, like a real reply-in-thread.
    const prior = gated.contactId ? this.sent.find(m => m.contactId === gated.contactId) : undefined;
    const ref: ProviderRef = {
      provider: 'mock-mailer', channel: 'email', inboxId: thread?.inboxId ?? 'mock-inbox',
      threadId: thread?.threadId ?? prior?.ref.threadId ?? `mock-thread-${n}`, messageId: `mock-message-${n}`, status: 'sent',
    };
    this.sent.push({
      to, body: gated.body, approvedAt: gated.approvedAt, ref, sentAt: this.now().toISOString(),
      ...(gated.subject !== undefined ? { subject: gated.subject } : {}),
      ...(gated.contactId !== undefined ? { contactId: gated.contactId } : {}),
      ...(gated.caseId !== undefined ? { caseId: gated.caseId } : {}),
    });
    return ref;
  }

  clear(): void { this.sent.length = 0; }
}
