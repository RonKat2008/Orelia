# AgentMail and AgentCall

Read-only checks on 2026-10-24 against `https://api.agentmail.to` and `https://api.agentcall.co` with the keys in `.env.local`. No inbox was created, no email was sent, and no call was placed. Recorded bodies (phones, addresses, and org ids scrubbed) are in `fixtures/api/agentmail/` and `fixtures/api/agentcall/`.

## Verified

### AgentMail

- `GET /v0/inboxes?limit=5` returned 200 `{ count, limit, inboxes[] }`. Each inbox has `inbox_id`, `email` (same value), `pod_id`, `display_name`, `created_at`, `updated_at`. The SDK maps those to camelCase; `AgentMailChannel` reads `inboxId` and `email`.
- `GET /v0/webhooks?limit=5` returned 200 `{ count: 0, limit, webhooks: [] }`.
- Send and reply paths in the adapter match the published routes: `POST /v0/inboxes`, `POST /v0/inboxes/{id}/messages/send` (`to`, `subject`, `text`, `labels`), `POST /v0/inboxes/{id}/messages/{message_id}/reply` (`to` as an array, `text`, `labels`). Responses are `{ message_id, thread_id }`.
- `GET /v0/threads/{thread_id}` messages use `message_id`, `from` (string), `to` (string array), `timestamp`, optional `subject` and `text`. That matches `listThreadMessages`.
- `message.received` webhooks are Svix: headers `svix-id`, `svix-timestamp`, `svix-signature` (`v1,<base64>` separated by spaces). HMAC-SHA256 of `` `${id}.${timestamp}.${rawBody}` `` with the base64 secret after `whsec_`. Documented tolerance is 5 minutes, which is what `verifyAgentMailSignature` uses. Payload fields the parser reads (`event_type`, `event_id`, `message.thread_id`, `message.message_id`, `extracted_text` / `text`, `timestamp`, `inbox_id`, `from`, `subject`) match the event reference.

### AgentCall

- `GET /v1/numbers`, `GET /v1/calls`, and `GET /v1/webhooks` returned 200. Lists are `{ data, hasMore, nextCursor }` (webhooks are `{ data }` only). Calls and webhooks were empty. One active local number was returned. Its `id` is a cuid, not the `num_…` prefix in the docs examples. The adapter sends that id as `from`.
- `GET /v1/calls/voices` (no auth) returned 200. `alloy` is a listed voice. `defaultVoice` is `shimmer`. `pricing.outboundAiVoice` and `pricing.inboundAiVoice` are `$0.40/minute`.
- `GET /v1/account` returned 200. This key is `plan: free`, `offerVersion: live_trial_72h_v1`, outbound `limits.maxCallMinutesPerMonth: 0`. Trial window was active through 2026-10-27. Docs say outbound `POST /v1/calls/ai` is Pro.
- Published `POST /v1/calls/ai` body fields the adapter sends and the docs name: `from`, `to` (E.164), `systemPrompt`, `voice`, `firstMessage`, `maxDurationSecs`. Documented response is `{ id, status: "queued", voice, ... }`. `pickId` accepts `id` or `callId`.
- `metadata` is documented as a string-to-string map echoed on call webhooks. The adapter only puts string `contactId` and `caseId` there.
- `idempotencyKey` is documented for outbound AI calls on agentcall.co.
- Webhook signing matches the post-call docs: `X-AgentCall-Signature: sha256=<hex HMAC-SHA256 of the raw body>`. No timestamp tolerance is documented, and the verifier does not check one. Envelope is `{ event, timestamp, data }`. `call.transcript` turns are `{ role: "ai"|"human", text, timestamp }` on `data.transcript`, which `parseAgentCallWebhook` already reads. `call.status` carries `data.status` (`initiated`, `ringing`, `in-progress`, `completed`, `busy`, `no_answer`, `failed`).
- `GET /v1/calls/:callId/transcript` is documented as `{ entries: [{ role, text, timestamp }], summary }`, with example roles `assistant` rather than `ai`. `getTranscript` / `getCall` now read `transcript` or `entries` and map `assistant`/`ai` to `ai` and `user`/`human`/`caller` to `human`. The account had no calls, so this mapping is locked to the documented fixture `fixtures/api/agentcall/transcript-documented.json`, not a live body.

## UNVERIFIED

These need a send or a completed call. Do not run them except against an allowlisted number or inbox we own.

| Item | First live check |
|---|---|
| Inbox create idempotency (`client_id` returns the existing inbox) | `POST /v0/inboxes` twice with the same `client_id` and confirm one inbox. |
| Send and reply response ids | Send one text-only message to an allowlisted AgentMail inbox, then reply, and confirm `message_id` and `thread_id`. |
| Thread GET after a real message | `GET /v0/threads/{thread_id}` and confirm `messages[].timestamp` parses. |
| Svix signature on a real delivery | Register the webhook, send one email into the case inbox, and confirm `verifyAgentMailSignature` accepts the raw body. |
| `POST /v1/calls/ai` accepts `record: false` | The field is documented on `POST /v1/calls/initiate`, not in the AI example. Place one allowlisted call and confirm it is not rejected. |
| `POST /v1/calls/ai` on this free trial | `GET /v1/account` shows `maxCallMinutesPerMonth: 0` and docs say AI calls are Pro. Expect 403 until the account is Pro. First check: one call to the allowlisted number only. |
| Live transcript GET | After that call completes, `GET /v1/calls/:id/transcript` and confirm `entries` (or `transcript`) and the role strings. |
| Live `call.transcript` / `call.status` delivery | Confirm the webhook body matches the documented envelope and the signature header. |

## Rate limits and cost

- AgentMail bills capacity, not a per-email unit price. Published plans (https://www.agentmail.to/pricing): Free $0 (3 inboxes, 3,000 emails/month, 100/day); Developer $20/month (10 inboxes, 10,000/month, 1,000/day, 100 per 5 minutes); Startup $200/month. Extra inbox, domain, or 1,000 monthly sends is $2/month. API 429s include `Retry-After` (usually 1 second). Numeric request-per-minute caps are not published.
- AgentCall (https://api.agentcall.co/llms.txt): 100 requests/minute (429). Pro is $19.99/month plus usage. Managed AI voice is $0.40/minute (confirmed on `GET /v1/calls/voices`), billed in whole minutes. Local numbers $2/month, standard outbound voice $0.035/minute. SMS is out of scope here.

## Webhook registration

`npx tsx scripts/register-webhooks.ts --base-url https://<host>` is a dry-run. Pass `--apply` to write.

- AgentMail: `POST /v0/webhooks` or `PATCH /v0/webhooks/{id}` with `event_types: ["message.received"]` at `/api/webhooks/agentmail`. Same URL is reused. `client_id` is `wayfinder-agentmail-webhook`.
- AgentCall: `POST /v1/webhooks` with `events: ["call.status", "call.transcript"]` at `/api/webhooks/agentcall`. There is no documented update route. A matching URL that already has both events is reused. A matching URL that is missing an event is deleted and recreated, which rotates the secret.
- `--apply` prints `AGENTMAIL_WEBHOOK_SECRET` and `AGENTCALL_WEBHOOK_SECRET` once on stdout. Dry-run prints the names only.

## First live call checklist

1. Allowlisted destination only (`OUTBOUND_ALLOWLIST`). Leave `OUTBOUND_ALLOW_REAL` unset.
2. Confirm the account can place AI calls (`GET /v1/account` limits, Pro if required).
3. The spoken script and `firstMessage` both start with the AI disclosure (`AI_DISCLOSURE_VOICE`).
4. Set `maxDurationSecs` (the channel option). The adapter omits it when unset.
5. `record` stays false unless a later review allows recording.
6. Register webhooks with `--apply` and store the printed secrets in the environment, not in the repo.
7. Confirm `call.status` and then `call.transcript` arrive at `/api/webhooks/agentcall`, the signature verifies, and the transcript text is the call body.
