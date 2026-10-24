import type { GatedDraft } from '../safety/outbound-gate';
import type { Channel, ProviderRef } from './types';
export class MockChannel implements Channel {
  readonly sent: GatedDraft[] = [];
  constructor(readonly kind: 'email' | 'voice') {}
  async send(draft: GatedDraft): Promise<ProviderRef> {
    if (!draft.approvedAt || draft.channel !== this.kind) throw new Error('Invalid gated draft');
    this.sent.push(draft);
    const id = `mock-${crypto.randomUUID()}`;
    return this.kind === 'email' ? { messageId: id, threadId: id } : { callId: id };
  }
}
