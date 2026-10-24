/** Approval notices carry a count and a link. They never include case or clinical text. */
export function approvalNotice(count: number, link: string): { subject: string; text: string } {
  const n = Math.max(0, Math.floor(count));
  const text = `You have ${n} item(s) waiting for your approval in Wayfinder.\n${link}`;
  return { subject: 'Wayfinder: approval waiting', text };
}

const HEALTH_LEAK = /\b(diagnos\w*|symptom|prognosis|treatment|biopsy|tumor|tumour|cancer|disease|medication|dosage|icd|orpha)\b/i;

export function noticeHasHealthDetails(text: string): boolean {
  return HEALTH_LEAK.test(text);
}
