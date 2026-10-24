import { skeleton } from './confusables';

export const EMERGENCY_MESSAGE = 'If you have new or worsening symptoms, contact your care team or call 911.';

/** Treatment vocabulary shared by several rules. Directive phrases only count when they reach one of these. */
const TREAT =
  '(?:chemo\\w*|radiation|radiotherap\\w*|surgery|surgical|immunotherap\\w*|therap(?:y|ies)|treatments?|medications?|medicines?|meds|drugs?|doses?|dosage|steroids?|prednisone|antibiotics?|inhibitors?|transplants?|supplements?|vitamins?|opioids?|painkillers?|pills?|tablets?|injections?|infusions?|regimens?|aspirin|ibuprofen|acetaminophen|[a-z]{3,}(?:mab|nib|ciclib|parib)\\b)';
const DIRECTIVE = "(?:you\\s+(?:should|must|need to|have to|ought to|had better)|i\\s+(?:recommend|advise|suggest|urge)(?:\\s+that\\s+you)?|we\\s+(?:recommend|advise|suggest|urge)(?:\\s+that\\s+you)?|(?:your\\s+)?(?:doctor|physician|oncologist|clinic|clinician|dr\\.?\\s+\\w+)\\s+(?:recommends?|advises?|suggests?|prescribes?))";
const ACTION = '(?:start|begin|stop|quit|discontinue|continue|resume|avoid|skip|take|switch(?:\\s+to)?|undergo|try|use|choose|receive|get|have|pursue|refuse|decline|delay|increase|decrease|reduce|double|halve)';

export interface AdviceRule {
  readonly id: string;
  readonly pattern: RegExp;
}

/** Table of deterministic rules. Add a row plus a test row in tests/safety/no-medical-advice.test.ts. */
export const ADVICE_RULES: readonly AdviceRule[] = [
  { id: 'directive-treatment', pattern: new RegExp(`\\b${DIRECTIVE}\\s+(?:${ACTION}\\s+)?(?:\\w+\\s+){0,3}${TREAT}\\b[^.!?]*`, 'gi') },
  { id: 'directive-start-stop', pattern: /\b(?:you should|you must|you need to|we recommend|i recommend)\s+(?:take|start|stop|increase|decrease|switch to|undergo)\b[^.!?]*/gi },
  { id: 'dose-change', pattern: /\b(?:increase|decrease|double|halve|reduce|adjust|stop|skip|change|lower|raise)\s+(?:your|the)\s+(?:\w+\s+)?(?:dose|dosage|medication|meds|prescription)\b/gi },
  { id: 'stop-taking', pattern: /\b(?:stop|quit|discontinue|start|begin|resume|keep)\s+taking\s+(?:your\s+|the\s+|any\s+)?\w+/gi },
  { id: 'schedule', pattern: /\btake\s+[^.!?]{1,40}\b(?:daily|twice a day|once a day|nightly|every \d+ hours|at bedtime|with food|before meals)\b/gi },
  { id: 'dose-amount', pattern: /\b(?:take|increase|decrease|start|use|administer|inject|give)\s+[^.!?]{0,40}\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|iu|milligrams?|micrograms?|tablets?|pills?|capsules?|units?)\b/gi },
  { id: 'dose-per-weight', pattern: /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|units?)\s*(?:\/|per)\s*(?:kg|m2|m²|day|dose)\b/gi },
  { id: 'dose-of', pattern: /\b(?:recommended|starting|maintenance|loading|appropriate|safe|correct|right)\s+dos(?:e|age)\b/gi },
  { id: 'prognosis-statement', pattern: /\b(?:your\s+|the\s+patient'?s?\s+)?prognosis\s+(?:is|will be|looks|appears|seems)\b[^.!?]*/gi },
  { id: 'survival-odds', pattern: /\b(?:\d+(?:\.\d+)?\s*%\s*(?:chance|odds|probability|survival|cure|remission|mortality)|(?:chance|odds|probability|likelihood)\s+of\s+(?:survival|surviving|cure|remission|recurrence|relapse|dying|death|responding)|(?:median|overall|five[- ]year|5[- ]year|\d+[- ]year)\s+survival|survival\s+(?:rate|odds|time|chance)s?|life expectancy|mortality rate)\b/gi },
  { id: 'time-to-live', pattern: /\b(?:you have|expect|you can expect|you'll have|you will have)\s+(?:about\s+|only\s+|roughly\s+)?\d+\s+(?:months?|years?|weeks?|days?)\s+(?:to live|left)\b/gi },
  { id: 'outcome-prediction', pattern: /\byou(?:'ll|\s+will|\s+are going to|\s+are likely to|\s+are unlikely to)\s+(?:die|survive|recover|be cured|respond|relapse|get worse|get better|live)\b[^.!?]*/gi },
  { id: 'disease-status-claim', pattern: /\b(?:your|this)\s+(?:cancer|disease|condition|tumou?r)\s+(?:is|will be|has become)\s+(?:terminal|incurable|curable|untreatable|fatal|progressing|in remission|cured)\b/gi },
  { id: 'rank-treatment', pattern: /\b(?:best|preferred|recommended|superior|most effective|safest|first-line|top|ideal|optimal)\s+(?:\w+\s+)?(?:treatment|therapy|drug|medication|option|approach|regimen)\b/gi },
  { id: 'compare-treatment', pattern: new RegExp(`\\b${TREAT}\\b[^.!?]{0,60}\\b(?:better than|superior to|more effective than|safer than|worse than|inferior to|outperforms?|preferable to)\\b`, 'gi') },
  { id: 'which-treatment', pattern: /\b(?:which|what)\s+(?:treatment|therapy|drug|medication)\s+(?:is|should|would be|works)\b[^.!?]*/gi },
  { id: 'prescribe', pattern: /\b(?:recommend|prescribe|suggest|advise)\s+(?:\w+\s+){0,3}(?:chemo\w*|radiation|radiotherap\w*|surgery|immunotherap\w*|treatment|therapy|medication|drug)\b/gi },
  { id: 'interpret-results', pattern: /\byour\s+(?:scan|mri|ct|pet|biopsy|pathology|lab|labs|blood work|bloodwork|test|results?|marker|levels?|count)s?\s+(?:shows?|indicates?|means?|suggests?|confirms?|reveals?|is|are)\b[^.!?]*/gi },
  { id: 'diagnose', pattern: /\byou\s+(?:probably|likely|definitely|clearly|most likely)\s+have\b[^.!?]*/gi },
  { id: 'dismiss-symptoms', pattern: /\b(?:nothing to worry about|no need to (?:see|call|contact) (?:a|your) (?:doctor|care team|physician)|safe to ignore|don't worry about (?:the|your) symptoms?)\b/gi },
];

/** Normalize so spacing, case, unicode compatibility forms, lookalike letters, zero-width characters and curly quotes cannot dodge the table. */
function normalizeText(text: string): string {
  return skeleton(text)
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

export interface AdviceFlag {
  flagged: boolean;
  matches: string[];
  /** Ids of the rules that matched (stable, for tests and audit). */
  rules: string[];
}

/** A deterministic review aid, not a complete medical-content classifier. */
export function flagMedicalAdvice(text: string): AdviceFlag {
  const normalized = normalizeText(text);
  const hits = ADVICE_RULES.flatMap(rule =>
    [...normalized.matchAll(new RegExp(rule.pattern))].map(match => ({ id: rule.id, text: match[0].trim() })),
  );
  const matches = [...new Set(hits.map(h => h.text))];
  return { flagged: matches.length > 0, matches, rules: [...new Set(hits.map(h => h.id))] };
}

/**
 * Optional second stage (for example a model call). Implementations must be injected by the caller; nothing in
 * this module makes a network call. Only text that passes the deterministic stage reaches the classifier.
 */
export interface MedicalAdviceClassifier {
  classify(text: string): Promise<{ flagged: boolean; reason?: string }>;
}

export interface TwoStageResult extends AdviceFlag {
  stage: 'deterministic' | 'classifier' | 'none';
  reason?: string;
}

/** Deterministic rules first; the classifier (if any) is consulted only when they pass. Fails closed on error. */
export async function flagMedicalAdviceTwoStage(text: string, classifier?: MedicalAdviceClassifier): Promise<TwoStageResult> {
  const first = flagMedicalAdvice(text);
  if (first.flagged) return { ...first, stage: 'deterministic' };
  if (!classifier) return { ...first, stage: 'none' };
  try {
    const verdict = await classifier.classify(text);
    return verdict.flagged
      ? { flagged: true, matches: [text.slice(0, 120)], rules: ['classifier'], stage: 'classifier', ...(verdict.reason ? { reason: verdict.reason } : {}) }
      : { ...first, stage: 'none' };
  } catch (error) {
    return { flagged: true, matches: [text.slice(0, 120)], rules: ['classifier-error'], stage: 'classifier', reason: error instanceof Error ? error.message : String(error) };
  }
}
