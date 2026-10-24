import { AI_DISCLOSURE_VOICE } from '../safety/disclosure';
import { assertGated, ChannelError, type Channel, type ChannelGuardOptions, type GatedDraft, type ProviderRef } from './types';

export interface MockCall {
  readonly to: string;
  readonly script: string;
  readonly approvedAt: string;
  readonly contactId?: string;
  readonly caseId?: string;
  readonly ref: ProviderRef;
  readonly placedAt: string;
  status: 'queued' | 'completed';
  transcript?: string;
}

/** In-memory caller for tests and the offline demo; no call is placed. */
export class MockCaller implements Channel {
  readonly kind = 'voice' as const;
  readonly calls: MockCall[] = [];
  private seq = 0;
  constructor(private guard: ChannelGuardOptions, private now = () => new Date()) {}

  async send(gated: GatedDraft): Promise<ProviderRef> {
    const to = assertGated(gated, 'voice', 'mock-caller', this.guard);
    // The gate already checks this; the mock keeps the same contract as the real caller.
    if (!gated.body.trimStart().startsWith(AI_DISCLOSURE_VOICE)) throw new ChannelError('mock-caller', 'Script must begin with the spoken AI disclosure');
    const ref: ProviderRef = { provider: 'mock-caller', channel: 'voice', callId: `mock-call-${++this.seq}`, status: 'queued' };
    this.calls.push({
      to, script: gated.body, approvedAt: gated.approvedAt, ref, placedAt: this.now().toISOString(), status: 'queued',
      ...(gated.contactId !== undefined ? { contactId: gated.contactId } : {}),
      ...(gated.caseId !== undefined ? { caseId: gated.caseId } : {}),
    });
    return ref;
  }

  /** Demo/test hook: finish a placed call with a synthetic transcript. */
  complete(callId: string, transcript: string): MockCall {
    const call = this.calls.find(c => c.ref.callId === callId);
    if (!call) throw new ChannelError('mock-caller', `Unknown call ${callId}`);
    call.status = 'completed'; call.transcript = transcript;
    return call;
  }

  clear(): void { this.calls.length = 0; }
}
