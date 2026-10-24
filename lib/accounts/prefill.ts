import type { CaseInput } from '@/lib/contracts/case';
import type { Profile } from './contract';

/**
 * Intake pre-fill from the profile: fills only fields the report left empty, never overwrites what the patient or the
 * report said. Pre-filling is local to the form; consent still decides what is ever shared outbound.
 */
export function mergeProfileIntoDraft<T extends CaseInput>(draft: T, profile: Profile | null): { draft: T; filled: (keyof CaseInput)[] } {
  if (!profile) return { draft, filled: [] };
  const filled: (keyof CaseInput)[] = [];
  const next: T = { ...draft };
  const fill = <K extends keyof CaseInput>(key: K, value: CaseInput[K] | undefined) => {
    const current = next[key];
    const empty = current === undefined || current === null || current === '' || (Array.isArray(current) && current.length === 0);
    if (!empty || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return;
    next[key] = value as T[K];
    filled.push(key);
  };
  fill('diseaseName', profile.primaryDiagnosis);
  fill('homeCity', profile.city);
  fill('homeState', profile.state);
  fill('insurer', profile.insurer);
  fill('planId', profile.plan);
  fill('travelLimitMiles', profile.travelLimitMiles);
  fill('goals', profile.goals);
  return { draft: next, filled };
}

/**
 * A short intake report written from the profile (diagnosis and where the patient lives only: minimum necessary,
 * no medications, allergies, identifiers or contact details).
 */
export function profileReportText(profile: Profile | null): string | null {
  if (!profile?.primaryDiagnosis) return null;
  const lines = [
    `Diagnosis: ${profile.primaryDiagnosis}${profile.diagnosedOn ? ` (diagnosed ${profile.diagnosedOn})` : ''}.`,
    profile.otherConditions ? `Other conditions: ${profile.otherConditions.slice(0, 500)}` : '',
    profile.city || profile.state ? `Lives in ${[profile.city, profile.state].filter(Boolean).join(', ')}.` : '',
    profile.travelLimitMiles !== undefined ? `Can travel up to ${profile.travelLimitMiles} miles.` : '',
    profile.insurer ? `Insurance: ${profile.insurer}${profile.plan ? ` ${profile.plan}` : ''}.` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  return text.length >= 20 ? text : `${text}\nAdult patient looking for specialist care.`;
}
