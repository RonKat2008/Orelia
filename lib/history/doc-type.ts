import type { DocType } from './contract';

const RULES: [DocType, RegExp][] = [
  ['discharge_summary', /\b(?:discharge|admission|inpatient|hospital course)\b/i],
  ['genetic_report', /\b(?:genetic|genomic|variant|sequenc\w*|gene panel|exome|genotyp\w*|molecular)\b/i],
  ['imaging_report', /\b(?:MRI|MRA|CT|PET|[Uu]ltrasound|[Ss]onograph\w*|[Xx]-?[Rr]ay|[Rr]adiograph\w*|[Ee]chocardiogra\w*|[Aa]ngiogra\w*|[Ii]maging|[Rr]adiology)\b/],
  ['lab_report', /\b(?:lab(?:oratory)? (?:results?|report)|labs|CBC|chemistry|serum|titer|urinalysis|lipid panel)\b/i],
  ['letter', /\b(?:dear dr|dear doctor|sincerely|letter|to whom it may concern|re:)\b/i],
  ['visit_note', /\b(?:visit|consult\w*|progress note|clinic|office|follow-?up|encounter|soap|assessment and plan)\b/i],
];

/** Guess the kind of record from its title first, then the opening of its text. */
export function inferDocType(title: string, text: string): DocType {
  for (const [type, re] of RULES) if (re.test(title)) return type;
  const head = text.slice(0, 800);
  for (const [type, re] of RULES) if (re.test(head)) return type;
  return 'other';
}
