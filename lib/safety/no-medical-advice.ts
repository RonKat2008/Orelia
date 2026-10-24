export const EMERGENCY_MESSAGE = 'If you have new or worsening symptoms, contact your care team or call 911.';
/** A deterministic review aid, not a complete medical-content classifier. */
const patterns = [
  /\b(?:you should|you must|you need to|we recommend|i recommend)\s+(?:take|start|stop|increase|decrease|switch to|undergo)\b[^.!?]*/gi,
  /\b(?:increase|decrease|double|reduce|adjust|stop)\s+(?:your|the)\s+(?:dose|dosage|medication)\b/gi,
  /\btake\s+[^.!?]{1,40}\b(?:daily|twice a day|every \d+ hours|at bedtime)\b/gi,
  /\b(?:you should|you must|you need to|we recommend|i recommend|we advise|i advise)\s+(?:(?:start|take|try|undergo|use|choose|receive|consider)\s+)?(?:\w+\s+){0,3}(?:treatment|therapy|chemotherapy|radiation|surgery|medication|drug|dose|immunotherapy)\b/gi,
  /\b(?:your\s+)?prognosis\s+(?:is|will be|looks)\b[^.!?]*/gi,
  /\b(?:take|increase|decrease|start|use|administer)\s+[^.!?]{0,40}\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|milligrams?|tablets?|pills?|units?)\b/gi,
  /\b(?:best|preferred|recommended|superior|most effective)\s+(?:treatment|therapy|drug|medication|option)\b/gi,
  /\b(?:therapy|treatment|drug)\b[^.!?]{0,40}\b(?:better than|superior to|more effective than)\b/gi,
  /\b(?:recommend|prescribe)\s+(?:\w+\s+){0,3}(?:chemotherapy|radiation|surgery|immunotherapy|treatment|therapy)\b/gi,
  /\b(?:you have|expect|you can expect)\s+\d+\s+(?:months?|years?|weeks?)\s+to live\b/gi,
];
export function flagMedicalAdvice(text: string): { flagged: boolean; matches: string[] } {
  const matches = [...new Set(patterns.flatMap(pattern => [...text.matchAll(new RegExp(pattern))].map(match => match[0])))];
  return { flagged: matches.length > 0, matches };
}
