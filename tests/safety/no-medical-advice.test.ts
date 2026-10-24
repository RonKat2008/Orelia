import { describe, expect, it } from 'vitest';
import { flagMedicalAdvice, flagMedicalAdviceTwoStage, type MedicalAdviceClassifier } from '../../lib/safety/no-medical-advice';

const POSITIVES: ReadonlyArray<readonly [string, string]> = [
  ['directive-treatment', 'You should start chemotherapy next week.'],
  ['directive-treatment', 'You need to stop the steroids.'],
  ['directive-treatment', 'Your oncologist recommends radiation first.'],
  ['directive-treatment', 'We advise that you undergo surgery soon.'],
  ['directive-treatment', 'You must avoid immunotherapy.'],
  ['dose-change', 'Double your dose if the pain returns.'],
  ['dose-change', 'Skip the dose tonight.'],
  ['stop-taking', 'Stop taking your medication today.'],
  ['stop-taking', 'Start taking ibuprofen.'],
  ['schedule', 'Take one tablet with food.'],
  ['dose-amount', 'Take 20 mg every morning.'],
  ['dose-amount', 'Inject 0.5 ml under the skin.'],
  ['dose-per-weight', 'A regimen of 5 mg/kg is typical.'],
  ['dose-of', 'The recommended dose is two tablets.'],
  ['prognosis-statement', 'Your prognosis is poor.'],
  ['survival-odds', 'There is a 40% chance of survival.'],
  ['survival-odds', 'Median survival is 18 months.'],
  ['survival-odds', 'Five-year survival is low for this disease.'],
  ['time-to-live', 'You have 6 months to live.'],
  ['outcome-prediction', 'You will recover fully.'],
  ['disease-status-claim', 'Your cancer is incurable.'],
  ['rank-treatment', 'The best treatment is radiation.'],
  ['rank-treatment', 'First-line therapy works well here.'],
  ['compare-treatment', 'Therapy A is better than therapy B.'],
  ['compare-treatment', 'Immunotherapy is safer than chemotherapy.'],
  ['which-treatment', 'Which treatment is right depends on you.'],
  ['prescribe', 'I would prescribe chemotherapy.'],
  ['interpret-results', 'Your MRI shows the tumor is shrinking.'],
  ['interpret-results', 'Your blood work indicates remission.'],
  ['diagnose', 'You probably have lupus.'],
  ['dismiss-symptoms', 'That is nothing to worry about.'],
  ['directive-treatment', 'YOU  SHOULD\nSTART   CHEMOTHERAPY'],
  ['directive-treatment', 'You should take aspirin.'],
  ['dose-change', 'Increase your dose.'],
  ['rank-treatment', 'Chemotherapy is the best option.'],
  ['schedule', 'Take aspirin daily.'],
  ['dose-amount', 'Take 20 mg daily.'],
];

const NEGATIVES: readonly string[] = [
  'The clinic recommends sending slides before the visit.',
  'A trial recruiting adults with epithelioid sarcoma.',
  'Please arrange a second opinion and send records.',
  'You should contact the clinic to ask about their intake process.',
  'You should send your records to the center.',
  'The foundation recommends joining their patient registry.',
  'ClinicalTrials.gov lists NCT01234567 as RECRUITING (Phase 2, sponsor Example Cancer Center).',
  'This center runs a dedicated program for vascular Ehlers-Danlos syndrome.',
  'The trial studies a drug called pembrolizumab in adults.',
  'Our coordinator can help you schedule an appointment.',
  'Financial aid is available for travel and lodging.',
  'The author has 12 papers on this disease published in the last 5 years.',
  'We recommend calling during business hours.',
  'You may want to ask your care team about eligibility.',
  'The patient advocacy group offers a support line.',
  'Dr. Smith is listed as a principal investigator.',
  'Please take a moment to review the attached summary.',
  'If you have new or worsening symptoms, contact your care team or call 911.',
  'The survey takes 5 minutes.',
  'The study reports survival as a secondary outcome measure.',
];

describe('flagMedicalAdvice (table-driven)', () => {
  it.each(POSITIVES)('flags [%s] %j', (rule, text) => {
    const result = flagMedicalAdvice(text);
    expect(result.flagged).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.rules.length).toBeGreaterThan(0);
    void rule;
  });

  it.each(NEGATIVES)('passes benign text %j', text => {
    expect(flagMedicalAdvice(text)).toMatchObject({ flagged: false, matches: [] });
  });

  it('resists case, whitespace, curly-quote and zero-width evasion', () => {
    expect(flagMedicalAdvice('You​ should start chemo​therapy.').flagged).toBe(true);
    expect(flagMedicalAdvice("You’ll recover fully").flagged).toBe(true);
    expect(flagMedicalAdvice('you will recover fully').flagged).toBe(true);
  });
});

describe('flagMedicalAdviceTwoStage', () => {
  const always: MedicalAdviceClassifier = { classify: async () => ({ flagged: true, reason: 'model says advice' }) };
  const never: MedicalAdviceClassifier = { classify: async () => ({ flagged: false }) };
  const broken: MedicalAdviceClassifier = { classify: async () => { throw new Error('down'); } };
  const benign = 'Please send the slides.';

  it('makes no classifier call by default', async () => {
    expect(await flagMedicalAdviceTwoStage(benign)).toMatchObject({ flagged: false, stage: 'none' });
  });
  it('skips the classifier when the deterministic stage already flags', async () => {
    let called = false;
    const spy: MedicalAdviceClassifier = { classify: async () => { called = true; return { flagged: false }; } };
    expect(await flagMedicalAdviceTwoStage('Your prognosis is poor.', spy)).toMatchObject({ flagged: true, stage: 'deterministic' });
    expect(called).toBe(false);
  });
  it('lets the classifier flag text the patterns miss, and passes when it agrees', async () => {
    expect(await flagMedicalAdviceTwoStage(benign, always)).toMatchObject({ flagged: true, stage: 'classifier', reason: 'model says advice' });
    expect(await flagMedicalAdviceTwoStage(benign, never)).toMatchObject({ flagged: false });
  });
  it('fails closed when the classifier errors', async () => {
    expect(await flagMedicalAdviceTwoStage(benign, broken)).toMatchObject({ flagged: true, rules: ['classifier-error'] });
  });
});

describe('stress-features: advice phrased as statements of fact', () => {
  it.each([
    'Imatinib is the standard of care and is recommended for this condition.',
    'Treatment with corticosteroids is indicated.',
    'Doctors typically prescribe tacrolimus.',
    'Consider chemotherapy before radiation.',
    'Avoid ibuprofen with this condition.',
    'Rituximab is a good option.',
  ])('flags: %s', text => {
    expect(flagMedicalAdvice(text).flagged).toBe(true);
  });
});
