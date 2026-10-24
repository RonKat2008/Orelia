export const AI_DISCLOSURE_EMAIL = 'This message was prepared with AI assistance and approved by the patient.';
export const AI_DISCLOSURE_VOICE = 'I am an AI assistant calling on behalf of the patient, with their approval.';
export function hasDisclosure(body: string): boolean {
  return body.includes(AI_DISCLOSURE_EMAIL) || body.includes(AI_DISCLOSURE_VOICE);
}
export function withDisclosure(body: string): string {
  return body.includes(AI_DISCLOSURE_EMAIL) ? body : `${body.trimEnd()}\n\n${AI_DISCLOSURE_EMAIL}`;
}
