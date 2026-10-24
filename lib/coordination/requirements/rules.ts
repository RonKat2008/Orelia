/** Keyword rules shared by the extractor and the status matcher. Administrative terms only; no clinical logic. */
export const RECORD_TYPES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'imaging', re: /\b(imaging|mri|ct\b|pet\b|x-?ray|scans?|radiolog\w*)/i },
  { name: 'pathology', re: /\b(patholog\w*|slides?|biops\w*)/i },
  { name: 'genetic testing', re: /\b(genetic|genomic|sequencing|genotyp\w*)/i },
  { name: 'lab results', re: /\b(lab(oratory)?\s+(results?|reports?)|blood\s*work|labs\b)/i },
  { name: 'clinic notes', re: /\b(clinic|office|visit|progress|consult(ation)?)\s+notes?/i },
];

export function recordTypesIn(text: string): string[] {
  return RECORD_TYPES.filter(t => t.re.test(text)).map(t => t.name);
}
