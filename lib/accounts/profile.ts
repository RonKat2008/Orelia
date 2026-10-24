import { ADULT_AGE, ADULT_ONLY_MESSAGE, profileSchema, type Profile } from './contract';

/** Whole years between an ISO date of birth and `now` (UTC). NaN for an impossible date. */
export function ageOn(dateOfBirth: string, now: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const dob = new Date(Date.UTC(y, m - 1, d));
  if (dob.getUTCFullYear() !== y || dob.getUTCMonth() !== m - 1 || dob.getUTCDate() !== d) return Number.NaN;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() < m - 1 || (now.getUTCMonth() === m - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

export type ProfileValidation =
  | { ok: true; profile: Profile }
  | { ok: false; status: 422; error: 'invalid'; issues: { path: string; message: string }[] }
  | { ok: false; status: 422; error: 'adult_only'; message: string };

/** Zod validation plus the adult-only rule (Wayfinder serves adults; same scope as the pediatric filter). */
export function validateProfile(input: unknown, now: Date = new Date()): ProfileValidation {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, status: 422, error: 'invalid',
      issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) };
  }
  const age = ageOn(parsed.data.dateOfBirth, now);
  if (!Number.isFinite(age) || age > 130) {
    return { ok: false, status: 422, error: 'invalid', issues: [{ path: 'dateOfBirth', message: 'Enter a real date of birth' }] };
  }
  if (age < 0) return { ok: false, status: 422, error: 'invalid', issues: [{ path: 'dateOfBirth', message: 'Date of birth is in the future' }] };
  if (age < ADULT_AGE) return { ok: false, status: 422, error: 'adult_only', message: ADULT_ONLY_MESSAGE };
  return { ok: true, profile: parsed.data };
}
