import { flagMedicalAdvice } from '../safety/no-medical-advice';
import type { Appointment } from './schema';
import { prepItemsFor } from './prep-items';

export { PREP_ITEMS, prepItemsFor, type PrepItem } from './prep-items';

/** Plain-text event description: checklist, the patient's own questions, and links. No diagnosis, no advice. */
export function eventDescription(a: Appointment, opts: { appUrl?: string } = {}): string {
  const items = prepItemsFor(a).map(i => `${a.prepNotes.checked[i.id] ? '[x]' : '[ ]'} ${i.label}`);
  const parts = [
    'Bring / prepare:',
    ...items,
    ...(a.prepNotes.questions.length ? ['', 'My questions:', ...a.prepNotes.questions.map(q => `- ${q}`)] : []),
    ...(a.phone ? ['', `Office phone: ${a.phone}`] : []),
    ...(a.telehealthUrl ? ['', `Join: ${a.telehealthUrl}`] : []),
    ...(opts.appUrl ? ['', `Details: ${opts.appUrl}`] : []),
    '',
    'Added by Orelia. Not medical advice.',
  ];
  const text = parts.join('\n');
  // Generated text is screened; patient questions are theirs, so only the generated lines are checked.
  const generated = parts.filter(p => !a.prepNotes.questions.some(q => p === `- ${q}`)).join('\n');
  if (flagMedicalAdvice(generated).flagged) throw new Error('Prep text flagged for medical advice');
  return text;
}
