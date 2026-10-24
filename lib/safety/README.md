# Safety core

`checkOutbound` is pure and returns either `{ ok: false, reasons }` (all detected refusals) or `{ ok: true, payload }`. Channels must accept the exported `GatedDraft`, never a raw `SafetyDraft`. The payload is a frozen snapshot with normalized recipient and selected case data only; callers must keep it inside the trusted server boundary.

Callers supply the current case's complete contact list, its case record, per-contact consent, approved draft, parsed allowlist, mode, and current time. The current draft's `approvedAt` is required; a consent approval alone does not approve a message. Persisted approval must apply to the exact draft and consent being checked. This module does not authenticate the approval source.

Production remains allowlisted unless the caller explicitly supplies `outboundAllowReal: 'true'` from `OUTBOUND_ALLOW_REAL`. Dev and demo never bypass the allowlist. No environment variables, network, database, or external libraries are read here.

Contacts use `lastSentAt` and `followUpsSent` for follow-up checks, even when an existing recipient omits `contactId`. Supply both history fields. `canFollowUp` checks elapsed deadlines of 3 and 7 UTC business days from the supplied timestamp, excluding weekends and preserving time of day, with at most two follow-ups. Holidays and workflow time zones belong to the workflow layer. Terminal contacts cannot send. New contacts are refused once five active contacts exist.

Email bodies require `AI_DISCLOSURE_EMAIL`; voice scripts must begin with `AI_DISCLOSURE_VOICE`. Subjects undergo the same privacy and advice checks as bodies. Case-field detection normalizes case, Unicode, and whitespace and scans literal scalar values, including nested values. It cannot detect paraphrases, encoded values, or medical semantics. `flagMedicalAdvice` is a table-driven phrase filter (rules in `ADVICE_RULES`) and review aid, not a complete classifier; `flagMedicalAdviceTwoStage` accepts an injected `MedicalAdviceClassifier` (none by default, no live call). Human review and restricted drafting remain necessary.

Safety contracts are local plain TypeScript types pending alignment with `lib/contracts`; there are no schema dependencies.
