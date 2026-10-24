/** Wording of the AI-assistance disclosure (docs/PLAN.md HARD RULE 7). Voice must be spoken first on every call. */
export const AI_DISCLOSURE_EMAIL = 'About this message: an AI assistant wrote it on behalf of the patient, and the patient reviewed and approved it before it was sent. Replies are read by the assistant and shared with the patient.';
export const AI_DISCLOSURE_VOICE = 'This is an AI assistant, not a person, calling on behalf of a patient who approved this call.';
export function hasDisclosure(body: string): boolean {
  return body.includes(AI_DISCLOSURE_EMAIL) || body.includes(AI_DISCLOSURE_VOICE);
}
export function withDisclosure(body: string): string {
  return body.includes(AI_DISCLOSURE_EMAIL) ? body : `${body.trimEnd()}\n\n${AI_DISCLOSURE_EMAIL}`;
}
