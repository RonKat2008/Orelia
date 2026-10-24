# Safety core

`checkOutbound` is pure and returns either `{ ok: false, reasons }` (all detected refusals) or `{ ok: true, payload }`. Channels must accept the exported `GatedDraft`, never a raw `SafetyDraft`. The payload is a frozen snapshot with normalized recipient and selected case data only; callers must keep it inside the trusted server boundary.

Callers supply the current case's complete contact list, its case record, per-contact consent, approved draft, parsed allowlist, mode, and current time. The current draft's `approvedAt` is required; a consent approval alone does not approve a message. Persisted approval must apply to the exact draft and consent being checked. This module does not authenticate the approval source.

Production remains allowlisted unless the caller explicitly supplies `outboundAllowReal: 'true'` from `OUTBOUND_ALLOW_REAL`. Dev and demo never bypass the allowlist. No environment variables, network, database, or external libraries are read here.

Contacts use `lastSentAt` and `followUpsSent` for follow-up checks, even when an existing recipient omits `contactId`. Supply both history fields. `canFollowUp` checks elapsed deadlines of 3 and 7 UTC business days from the supplied timestamp, excluding weekends and preserving time of day, with at most two follow-ups. Holidays and workflow time zones belong to the workflow layer. Terminal contacts cannot send. New contacts are refused once five active contacts exist.

Email bodies require `AI_DISCLOSURE_EMAIL`; voice scripts must begin with `AI_DISCLOSURE_VOICE`. Subjects undergo the same privacy and advice checks as bodies. Case-field detection normalizes case, Unicode, and whitespace and scans literal scalar values, including nested values. It cannot detect paraphrases, encoded values, or medical semantics. `flagMedicalAdvice` is a table-driven phrase filter (rules in `ADVICE_RULES`) and review aid, not a complete classifier; `flagMedicalAdviceTwoStage` accepts an injected `MedicalAdviceClassifier` (none by default, no live call). Human review and restricted drafting remain necessary.

Safety contracts are local plain TypeScript types pending alignment with `lib/contracts`; there are no schema dependencies.

## Doctor-to-expert consultation gate

`checkConsultOutbound` (consult-gate.ts) wraps `checkOutbound` for physician consultation requests. It refuses unless the request is `doctor_approved`/`ready`, the patient's doctor approved it (`doctorApprovedAt <= now`), the patient consented after that approval (`doctorApprovedAt <= patientConsentAt <= now`), `sha256(subject + "\n" + body)` equals the hash stored at approval, and the expert address is a code-stamped contact point (evidence row `addressEvidenceId`). The contact cap is counted per resource. Then every `checkOutbound` check runs, with `approvedAt = patientConsentAt`.

Medical-advice filter decision: the phrase filter exists to stop AI-written advice reaching patients. A consult request is clinician-to-clinician text the patient's licensed physician approved word for word, and ordinary consult questions ("would you recommend surgery or radiation?") trip the filter. So, after the checks above pass, the consult gate mints a `PhysicianAuthoredExemption` (physician-exemption.ts) bound to the exact address, subject and body. `checkOutbound` then skips ONLY `flagMedicalAdvice` for that exact email. Approval, allowlist, cap, cadence, unshared-field and disclosure checks are unchanged. Look-alike objects are ignored (WeakSet membership). A test checks that only consult-gate.ts mints exemptions. Every other caller sees no change. Wayfinder's own consult draft (and any patient edit before the doctor sees it) still has to pass `flagMedicalAdvice` when it is drafted.

The review-link email to the patient's own doctor goes through `checkOutbound` with an empty contact list. The doctor is the patient's existing clinician, not an outreach contact, and the email carries no case data. The cap applies to the send to the expert.
