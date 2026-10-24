# Intake-door classifier

`classifyIntakeDoors(page: ExaPage)` consumes fetched text from `ExaClient` and
returns zero or more intake-door candidates with the exact returned URL and a
matching phrase. It does not search, fetch, send, invent a contact, or establish
that the service accepts this case. Pass wrapper-produced pages only; this pure
function cannot authenticate an arbitrary caller's provenance. Persist evidence
through the existing wrapper/verifier flow before displaying resource claims.

Titles and URL keywords alone do not establish a door. Each category requires a
phrase in fetched text. These are candidates for review, not verified scheduling
instructions. Multiple categories may coexist. No phone numbers are inferred.

Email handling is deliberately conservative: only a small allowlist of role-based
local parts is accepted. Named clinician addresses, initials, plus aliases, and
unknown mailbox names are rejected, even on hospital domains or beside intake
language. Only role emails in the same text block as the matched phrase are
returned. Excerpts contain the matching phrase, never surrounding personal emails.
This may omit valid department mailboxes; review or extend explicit patterns with
tests rather than guessing identities. A role-like mailbox name alone cannot prove
ownership and still requires human review and OutboundGate before outreach.

Recorded Exa fixtures exercise the classifier without API calls. No changes to
research-agent orchestration are included; that lane can import this pure module.
