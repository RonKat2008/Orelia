# Outreach backend

Routes (all identifiers are UUIDs):

- `POST /api/outreach/select {caseId, candidateIds}`: 1–5 distinct case-candidate IDs. Returns `{contacts, unavailable}`. Existing resource selections are idempotent; duplicate target resources are collapsed. Enforces the aggregate active-contact cap. Only evidenced intake/contact claims with an HTTP(S) source are eligible; role-based email is preferred, then normalized phone. Personal mailboxes are excluded.
- `PUT /api/contacts/[id]/consent {sharedFields}`: saves exactly the supplied patient-field keys and a server-generated approval timestamp. Keys use the frozen case contract: `diseaseName` (diagnosis), `subtype`, `stageSummary`, `homeCity`, `homeState`, `insurer`, `planId`, `travelLimitMiles`, `goals`. Empty consent is allowed. No implicit fields.
- `POST /api/contacts/[id]/drafts`: requires saved consent, creates a draft, returns its ID and content. Does not approve or send it. Templates use only minimized data. Trial, advocacy, aid and specialist/center requests differ. Voice starts with the required disclosure.
- `POST /api/contacts/[id]/approve {draftId}`: the explicit approval action. Uses server time (never a supplied timestamp), current consent and OutboundGate; returns `{draftId, approvedAt, sentAt, provider}`. All gate refusals return 422 `{reasons}`. Invalid requests return 400; missing records 404; duplicate/concurrent approval 409; provider/storage failure 503. No send occurs on refusal.

`OutreachService` accepts an `OutreachStore`, channels, environment and clock. Default routes use PostgreSQL and **local mocks**, which perform no network I/O. Supply real Channel implementations explicitly when the channel lane is integrated. The allowlist is read from `OUTBOUND_ALLOWLIST`; production still requires it. This integration never opts into `OUTBOUND_ALLOW_REAL`.

PostgreSQL selection locks the case before atomically checking capacity and inserting. Consent replacement and send reservation lock the contact. Reservation compares current consent with the draft's fields, checks unchanged content, and rejects previously approved outreach for that contact. Only after approval is persisted does the channel receive the immutable gated payload. An ambiguous provider failure leaves approval reserved: automatic retry is refused to prevent duplicates; reconciliation is required. These endpoints implement initial outreach only; follow-ups remain the workflow lane's responsibility.

Schema/API differences:

- Frozen `channel` enum has no `none`. Resources without evidenced intake contact are returned in `unavailable` with `channel: 'none'` and an explanation; no invalid/sendable contact row is manufactured.
- Drafts for both channels are stored as outbound `messages`; delivered voice drafts also create a `calls` row. Calls use `started_at`, since the schema has no `sent_at`; the message ledger records `sent_at` for both channels.
- UI task approval `{taskId, approvedAt}` and editing/rejecting drafts are not this API. The approval body is strictly `{draftId}`; client-supplied timestamps are rejected.
- Agent runtime and channel adapters were absent from this checkout. Deterministic drafts and local mock channels are implemented; optional model polish is omitted.

Tests exercise handlers offline and route delegation, including all-reasons refusals, no-send-before-approval, consent withdrawal, aggregate cap, duplicate selection, both channels and concurrent approvals. PostgreSQL queries typecheck but require a configured Neon database for live integration verification. No schema migrations or new dependencies are needed.
