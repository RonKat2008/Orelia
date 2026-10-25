# AgentCall voice integration

AgentCall (https://agentcall.co) is the voice provider behind `lib/channels/agentcall.ts`. It is NOT AgentPhone (agentphone.ai), which is a different product.

Sources: https://agentcall.co/docs, https://agentcall.co/docs/post-call-webhook, https://agentcall.co/docs/mcp, API reference UI https://api.agentcall.co/docs.

## Verified

- Base URL: `https://api.agentcall.co`
- Auth: `Authorization: Bearer <key>` (keys look like `ac_live_...`). The key is never put in error messages.
- Place AI call: `POST /v1/calls/ai`, JSON body: `from` (a number ID such as `num_abc123`, not a phone number), `to` (E.164), `firstMessage`, `systemPrompt`, `voice`, `language`, `maxDurationSecs`, `record`, `useSavedAgent`, `idempotencyKey`.
- Call status enum: `initiated`, `ringing`, `in-progress`, `completed`, `busy`, `no_answer`, `failed`.
- Webhook envelope: `{ event, timestamp (ISO), data }`. Events: `call.transcript`, `call.report.ready`, `transcript.partial`, `call.status`, `call.recording`.
- `call.transcript` data: `callId`, `duration`, `peerCallId`, `metadata` (optional string map), `transcript: [{ role: 'ai'|'human', text, timestamp }]`, `summary { summary, callerName, intent, urgency, callbackBy, spam }`.
- Signing: header `X-AgentCall-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw request body keyed with the webhook secret. Compared in constant time. No timestamp tolerance is documented, so replay protection must come from our own event dedupe.
- Rate limits: none documented.

## How Orelia uses it

- `send()` runs `assertGated` before any network call and requires the script to start with `AI_DISCLOSURE_VOICE`.
- `firstMessage` is the disclosure sentence, so it is spoken first. The full approved script goes into `systemPrompt` with an instruction to stay on script, give no medical advice and share nothing beyond it.
- `idempotencyKey` = first 32 hex of sha256(address, approvedAt, body), so retries do not double-dial.
- Webhooks are matched to calls Orelia created through `KnownThreadLookup`; others are rejected with 404.
- Errors: `ChannelError` with status, `retryable` = 429 or >= 500, and the parsed body.

## UNVERIFIED assumptions (confirm against the API reference UI before going live)

1. Response of `POST /v1/calls/ai` carries `id` or `callId` (and possibly `status`). Parsed defensively; neither present is an error.
2. Get call path: `GET /v1/calls/{id}`.
3. Transcript path: `GET /v1/calls/{id}/transcript`, returning `{ transcript: [...] }` or a bare array.
4. Dial-time metadata field is named `metadata` (sent as `{ contactId, caseId }`).
5. `record: false` is acceptable and desired by default.
6. Rate limits and 429 behaviour (e.g. a `Retry-After` header) are unknown.
7. Error body shape is unknown; it is passed through unparsed on `ChannelError.body`.
8. The webhook `callId` equals the id returned by the dial call.

No test or code path places a live call; all tests use a mocked `fetch`.
