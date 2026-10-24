/**
 * DEMO ONLY: simulated calls for demo destinations (see demo-destinations.ts).
 *
 * When demo mode is on and no test phone is allowlisted, call contacts point at the reserved DEMO_CALL_SINK. The
 * approval path is unchanged (patient approval -> checkOutbound -> channel.send). DemoCallSimulator sits in front of
 * the real voice channel: a gated payload addressed to the sink is answered locally ("demo: call simulated (no
 * allowlisted number)") and never reaches a provider; every other payload goes to the real channel untouched.
 * After delivery, the scripted transcript below runs through the normal transcript ingest, so the reply -> task ->
 * tracker flow works as it would for a real call.
 */
import { randomUUID } from 'node:crypto';
import { isGatedDraft, type GatedDraft } from '../safety/outbound-gate';
import { AI_DISCLOSURE_VOICE } from '../safety/disclosure';
import { DEMO_CALL_SIMULATED_NOTE, isDemoCallSink } from './demo-destinations';
import type { Channel, ProviderRef } from './types';

export const DEMO_CALL_ID_PREFIX = 'demo-sim-call-';

export const isSimulatedCallId = (id: string | null | undefined): boolean => !!id && id.startsWith(DEMO_CALL_ID_PREFIX);

export class DemoCallRefusedError extends Error {
  constructor(message: string) { super(message); this.name = 'DemoCallRefusedError'; }
}

/** Voice channel wrapper: the sink is simulated, anything else is delegated to the real (or mock) caller. */
export class DemoCallSimulator implements Channel {
  readonly kind = 'voice' as const;
  constructor(private readonly inner: Channel, private readonly newId: () => string = randomUUID) {}

  async send(gated: GatedDraft): Promise<ProviderRef> {
    if (!isDemoCallSink(gated.address)) return this.inner.send(gated);
    if (!isGatedDraft(gated) || gated.channel !== 'voice') throw new DemoCallRefusedError('Refusing payload that did not come from checkOutbound');
    if (!gated.body.trimStart().startsWith(AI_DISCLOSURE_VOICE)) throw new DemoCallRefusedError('Script must begin with the spoken AI disclosure');
    return { callId: `${DEMO_CALL_ID_PREFIX}${this.newId()}` };
  }
}

/**
 * Scripted reply from a synthetic intake coordinator. Generic on purpose: it asks for the usual referral items and
 * gives no medical advice. It is inbound text, classified like any real transcript.
 */
export function demoCallTranscript(): string {
  return [
    `AI: ${AI_DISCLOSURE_VOICE}`,
    'Callee: Thanks for calling the new-patient office, this is the intake coordinator. (Demo: Wayfinder test line, no real clinic.)',
    'AI: I am calling on behalf of a patient who would like to be seen for the condition in the approved script. How do they get started?',
    'Callee: We do see adults with that condition. To get them on the schedule we need a referral from their current doctor and their most recent records, including any imaging reports.',
    'AI: Thank you. Is there anything else you need before scheduling?',
    'Callee: Please have the records sent over, and we will call the patient back within a few business days to book the first visit.',
    'AI: Understood. I will pass that on. Thank you for your time.',
  ].join('\n');
}

export interface SimulatedCallIngest {
  (input: { contactId: string; caseId: string; callId: string; transcript: string; status: string; receivedAt: string }): Promise<void>;
}

/** Feeds the scripted transcript for a simulated call through the given ingest. Never throws (the send already happened). */
export async function completeSimulatedCall(ingest: SimulatedCallIngest, input: { contactId: string; caseId: string; callId: string; at: string }): Promise<boolean> {
  if (!isSimulatedCallId(input.callId)) return false;
  try {
    await ingest({ ...input, transcript: demoCallTranscript(), status: DEMO_CALL_SIMULATED_NOTE, receivedAt: input.at });
    return true;
  } catch (error) {
    console.error('[demo-call] simulated transcript ingest failed', error instanceof Error ? error.name : 'unknown');
    return false;
  }
}
