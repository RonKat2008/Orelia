# AgentMail integration

Adapter: `lib/channels/agentmail.ts` (`AgentMailChannel`, `verifyAgentMailSignature`, `parseAgentMailWebhook`). Tests mock `fetch`; no live API is ever called from tests.

## Verified endpoints (https://agentmail.to/docs/...)

Base `https://api.agentmail.to`, paths under `/v0`. Auth: `Authorization: Bearer <api key>`. Wire format is snake_case; the SDK exposes camelCase.

| Purpose | Endpoint | Notes |
|---|---|---|
| Create inbox | `POST /v0/inboxes` | `username`, `domain`, `display_name`, `client_id` (reuse returns the existing inbox), `metadata`. Returns `inbox_id`, `email`, `pod_id`, `created_at`, `updated_at`. |
| Send | `POST /v0/inboxes/{inbox_id}/messages/send` | `to`, `subject`, `text`, `html`, `labels`, `headers`... Returns `message_id`, `thread_id`. |
| Reply | `POST /v0/inboxes/{inbox_id}/messages/{message_id}/reply` | `text`, `html`, `labels`, `to`... Returns `message_id`, `thread_id`. |
| Get thread | `GET /v0/threads/{thread_id}` | `limit`, `page_token`; returns thread with `messages[]`. |

## SDK (agentmail 0.5.46), confirmed from .d.ts

- `new AgentMailClient({ apiKey, fetch?, baseUrl?, maxRetries?, ... })`
- `client.inboxes.create({ clientId, displayName, domain, username, metadata })` -> `Inbox { inboxId, email, podId, clientId, createdAt: Date, ... }`
- `client.inboxes.messages.send(inboxId, { to: string | string[], subject, text, html, labels, ... })` -> `{ messageId, threadId }`
- `client.inboxes.messages.reply(inboxId, messageId, { to, text, html, labels, replyAll, ... })` -> `{ messageId, threadId }`
- `client.threads.get(threadId, { limit, pageToken })` -> `Thread { messages: Message[] }`; `Message { messageId, from: string, to: string[], subject?, text?, extractedText?, timestamp: Date }`
- Errors extend `AgentMailError { statusCode, body }` (also `NotFoundError`, `ValidationError`, ...).
- The SDK retries 2x by default with backoff (honours `Retry-After`). The adapter passes `maxRetries: 0` on every call: a retried send could duplicate an email, so callers decide using `ChannelError.retryable`.

## Adapter behaviour

- One inbox per case, `clientId = wayfinder-case-<caseId>`; cached in memory, idempotent server-side. `send` auto-creates it. A missing `caseId` is refused.
- `assertGated(..., 'email', 'agentmail', guard)` runs before any network call. Only approved `text` is sent (never html/attachments). Labels: `wayfinder`, `case:<id>`, `contact:<id>`.
- `sendInThread(gated, { inboxId, messageId })` replies with explicit `to` = the allowlisted address.
- `listThreadMessages` refuses (404) any thread the lookup does not recognise, before fetching.
- Errors map to `ChannelError(status, retryable = 429 or >=500 or no response, body {code,name})`; the API key is redacted from messages.

## Webhooks

Delivered via Svix. Headers `svix-id`, `svix-timestamp` (unix seconds), `svix-signature` (space-separated `v1,<base64>`). Secret `whsec_<base64>`. Verification: HMAC-SHA256 with the base64-decoded secret over `${id}.${timestamp}.${rawBody}`, base64 output, timing-safe compare, 5 minute tolerance. Implemented by hand with `node:crypto` (`svix` is not a dependency). The raw body string must be verified before JSON parsing.

Events: `message.received` (+ `.spam`, `.blocked`, `.unauthenticated`), `message.sent`. Payload for `message.received`:
`{ type: 'event', event_type, event_id, message: { inbox_id, thread_id, message_id, from, to[], subject?, text?, html?, extracted_text?, timestamp, ... }, thread: {...} }`.

`parseAgentMailWebhook` returns `ProviderInbound & { contactId }` with `body = extracted_text ?? text ?? ''`. Errors: 401 bad signature, 400 malformed, 404 unknown thread, 422 any event other than `message.received` (the route should drop these).

## Rate limits

No published requests-per-second. Plan caps: Free 100 emails/day and 3 inboxes; Developer 1,000/day and 10 inboxes. Exceeding returns 429 with `Retry-After`. Source: https://agentmail.to/docs/knowledge-base/rate-limits.md

## Errors

Body `{ name, code, message, fix?, docs? }`. Source: https://agentmail.to/docs/errors.md

## UNVERIFIED

- The Svix signing string is not stated in AgentMail's docs; the standard Svix scheme is assumed. Confirm against a real delivery before production.
- Webhook body-size threshold: docs conflict (64 KiB vs 1 MB) on when the body is omitted in favour of `body_url`. The adapter does not fetch `body_url`; oversized messages yield an empty `body`.
- Label character/length restrictions for `case:<id>` / `contact:<id>` labels were not checked.
- Whether `extracted_text` is always present on webhooks (the adapter falls back to `text`).
- Behaviour of `reply` when `to` differs from the original sender.
