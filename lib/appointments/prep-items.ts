import type { Appointment } from './schema';

/**
 * Practical, non-clinical things to bring or do. Wayfinder never writes questions for the visit: the patient's own
 * questions are stored as they typed them.
 */
export interface PrepItem { id: string; label: string; hint?: string; when?: (a: Pick<Appointment, 'kind' | 'telehealthUrl' | 'location'>) => boolean }

export const PREP_ITEMS: readonly PrepItem[] = [
  { id: 'photo_id', label: 'Photo ID', when: a => !a.telehealthUrl || !!a.location },
  { id: 'insurance_card', label: 'Insurance card (front and back)' },
  { id: 'referral', label: 'Referral letter, if the office asked for one' },
  { id: 'records', label: 'Records the office asked for (reports, imaging discs, slides)', hint: 'Your documents are in the case library.' },
  { id: 'questions', label: 'Your own list of questions', hint: 'Write them below in your words.' },
  { id: 'arrive_early', label: 'Plan to arrive 15 minutes early for check-in', when: a => !!a.location && a.kind !== 'telehealth' },
  { id: 'test_link', label: 'Test the video link and your camera beforehand', when: a => !!a.telehealthUrl },
  { id: 'directions', label: 'Check directions and parking', when: a => !!a.location },
];

export function prepItemsFor(a: Pick<Appointment, 'kind' | 'telehealthUrl' | 'location'>): PrepItem[] {
  return PREP_ITEMS.filter(item => !item.when || item.when(a));
}

