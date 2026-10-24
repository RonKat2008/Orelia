/** Offline/demo: a synthetic, clearly fictional transcript for a verification call placed on the mock caller. */
import { AI_DISCLOSURE_VOICE } from '../safety/disclosure';
import type { Turn } from '../channels/agentcall';
import type { VerificationRequest, VerifyQuestionKey } from './contract';
import { locateQuestions } from './transcript';

const ANSWERS: Record<VerifyQuestionKey, string> = {
  treats_condition: 'Yes, we do. Our team sees adults with that condition regularly.',
  new_adult_patients: 'Yes, we are accepting new adult patients right now.',
  referral_required: 'Yes, a referral is required.',
  consultations: 'Yes, we offer consultations and second opinions.',
  how_to_start: 'The referring doctor faxes a referral and recent records to our intake office, and then we call the patient to schedule.',
  insurance: 'Yes, we accept that plan.',
};

/** Questions are read back from the approved script itself, so the simulation never asks anything else. */
export function syntheticVerificationTranscript(request: Pick<VerificationRequest, 'script'>): Turn[] {
  const section = request.script.split('\n\n').find(p => p.startsWith('Ask these questions')) ?? '';
  const questions = section.split('\n').slice(1).map(l => /^\d+\.\s+(.*)$/.exec(l)?.[1]).filter((q): q is string => !!q);
  const turns: Turn[] = [{ role: 'ai', text: AI_DISCLOSURE_VOICE }, { role: 'human', text: 'Okay, go ahead.' }];
  for (const q of questions) {
    const key = [...locateQuestions([{ speaker: 'agent', text: q }], {}).keys()][0];
    turns.push({ role: 'ai', text: q }, { role: 'human', text: key ? ANSWERS[key] : 'Sorry, could you repeat that?' });
  }
  turns.push({ role: 'ai', text: 'Thank you for your time. The patient will follow up.' });
  return turns;
}
