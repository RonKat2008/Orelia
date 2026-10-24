# Logistics flags

`inState(caseRecord, institution)` compares USPS codes after trim/case normalization;
missing or unsupported values return unknown. Full state names are intentionally
not guessed. `virtualVisitLicensureFlag(homeState, clinicianStates)` reports listed,
needs_verification, or unknown. A supplied state list is not proof of current
licensure, legal eligibility, or provider availability. The accompanying note must
remain visible when this flag is used. No current state-law table is asserted;
`data/state-telehealth-licensure.json` explicitly records that limitation.

`distance()` always returns `{status:'unknown'}` until a geocoding source is approved.
These functions perform no network requests and make no medical recommendations.
