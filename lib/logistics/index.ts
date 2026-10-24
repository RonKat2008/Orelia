/** Unknown is distinct from a confirmed out-of-state match. Accept USPS state codes only. */
const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export function normalizeState(value?: string | null): string | undefined {
  const code = value?.trim().toUpperCase();
  return code && states.has(code) ? code : undefined;
}
export function inState(caseRecord: { homeState?: string | null }, institution: { state?: string | null }): { status: 'yes' | 'no' | 'unknown' } {
  const home = normalizeState(caseRecord.homeState), destination = normalizeState(institution.state);
  return { status: !home || !destination ? 'unknown' : home === destination ? 'yes' : 'no' };
}
export const VIRTUAL_VISIT_NOTE = "Virtual visits usually require a clinician license in the patient's state. Confirm current licensure and exceptions with the provider; this flag does not establish eligibility.";
export function virtualVisitLicensureFlag(homeState?: string | null, clinicianStates?: readonly string[] | null): { status: 'listed' | 'needs_verification' | 'unknown'; note: string } {
  const home = normalizeState(homeState);
  const listed = clinicianStates?.map(normalizeState).filter((s): s is string => !!s);
  return { status: !home || !listed?.length ? 'unknown' : listed.includes(home) ? 'listed' : 'needs_verification', note: VIRTUAL_VISIT_NOTE };
}
export function distance(): { status: 'unknown' } { return { status: 'unknown' }; }
