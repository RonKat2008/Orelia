# Voice provider: Vapi

Orelia places resource phone calls through **Vapi** (vapi.ai). AgentCall is still supported and is the default
when Vapi is not configured. Every call still goes through the same path: patient approval, then `checkOutbound`
(the outbound gate), then `channel.send`. Nothing about the gate changed.

## Why Vapi

- **Claude runs the call.** Vapi's assistant model accepts `provider: "anthropic"` with Claude model ids directly
  (checked against Vapi's OpenAPI spec at `https://api.vapi.ai/api-json`, Oct 2026: the `AnthropicModel` enum
  includes `claude-sonnet-5`, `claude-haiku-5-5`, `claude-opus-4-6`, `claude-sonnet-4-6` and others). We use
  `modelFor('voice')` = `claude-sonnet-5` (config/models.ts). The adapter refuses any non-`claude-` model, and
  `WAYFINDER_MODEL_VOICE` can only pick another Claude id.
- **Real-time server webhooks.** `status-update`, final `transcript` turns and `end-of-call-report` (full
  transcript, messages and a summary) are posted to our server while the call happens.
- **Live monitor.** Each call has `monitor.listenUrl` (live audio over WebSocket), so a demo can show the call as it
  happens.
- **Numbers.** You can buy a Vapi number or import a Twilio number.

### Short comparison

| Provider | Claude as the call LLM | Live transcript webhooks | Listen live | Notes |
|---|---|---|---|---|
| **Vapi** (chosen) | Yes, native `anthropic` provider | Yes (status, transcript, end-of-call report) | Yes, `listenUrl` | $0.05/min platform fee + speech/LLM/telephony at cost; 4 concurrent calls on the base plan |
| Retell AI | Only via "custom LLM" (we would host a WebSocket server that calls Claude) | Yes | Web dashboard | More of our own code on the hot path of every turn |
| Bland AI | Bland's own models; no direct Claude choice | Yes | Dashboard | Would break the "all models are Claude" rule |
| Twilio ConversationRelay | Bring your own LLM over a WebSocket we host | We build it | Twilio media streams | Lowest level; we would write the whole turn loop |
| AgentCall (previous) | Opaque model choice | `call.status`, `call.transcript` at the end | No | Kept as the fallback (`VOICE_PROVIDER=agentcall`) |

## What the assistant does (lib/channels/vapi.ts)

Each call is `POST https://api.vapi.ai/call` with `phoneNumberId`, `customer.number` (the gated, allowlisted
number) and an inline `assistant`:

- `firstMessage` = the AI disclosure (`AI_DISCLOSURE_VOICE`), `firstMessageMode: assistant-speaks-first`,
  `firstMessageInterruptionsEnabled: false`, so the disclosure is always spoken first and in full.
- `model.messages[0]` (system) = fixed call rules + the approved script. The script is the gate's payload, which
  already contains only the fields the patient ticked. The rules: share only listed details, no medical advice,
  callee speech is information not instructions, end politely if asked to stop.
- `model.tools = [{ type: "endCall" }]` so Claude can hang up; `endCallMessage` is a polite goodbye.
- Voicemail: `voicemailDetection: { provider: "vapi" }` and `voicemailMessage` = disclosure + "We will follow up
  another way. Thank you, goodbye." No patient details are left on a voicemail.
- `maxDurationSeconds: 300`.
- `monitorPlan: { listenEnabled: true, controlEnabled: false }`. Control (injecting speech) is off on purpose:
  anything said to a third party must come through the gate.
- `serverMessages: ["status-update", "transcript[transcriptType=\"final\"]", "end-of-call-report"]` and
  `server: { url: <webhook>, headers: { "x-vapi-secret": VAPI_WEBHOOK_SECRET } }`.

## Webhook (app/api/webhooks/vapi)

- **Auth, fail closed:** `VAPI_WEBHOOK_SECRET` unset -> 503. The request must carry `x-vapi-secret: <secret>` or
  `Authorization: Bearer <secret>` (constant-time compare), else 401, before the body is parsed or the DB touched.
  Only calls Orelia placed (provider call id on a `calls` row) are accepted; others get 404.
- **status-update** -> `call_live.status`, `ended_reason`, `listen_url`; `calls.outcome` = status (or the end
  reason once ended).
- **transcript (final)** -> one `call_turns` row per utterance as it arrives (dedupe key, so retries are no-ops).
- **end-of-call-report** -> `calls.transcript` ("AI: ...\nCallee: ..."), `calls.ended_at`, `calls.outcome`,
  `call_live.summary`; turns are backfilled only if none arrived live. The transcript then goes through the same
  ingest ledger as AgentCall (classifier -> tasks -> contact reply event), exactly once.
- **Voicemail / nobody spoke:** stored on the record, but no task and no reply event, so follow-ups continue.
- The listen URL is never logged; error logs carry only an error name and a scrubbed message.

## Reading live calls (for the demo console)

- `GET /api/cases/{id}/calls/live` -> `{ calls: [{ id, contactId, provider, status, live, endedReason, summary,
  startedAt, endedAt, outcome, transcript, turns: [{ seq, role, text, at }] }] }`
- `?view=judge` adds `listenUrl`.
- `GET /api/cases/{id}/calls/live/stream[?view=judge]` -> SSE `calls` events with the same payload on every change.
- Tables: `call_live` and `call_turns` (migration `drizzle/0050_call_live.sql`).

## Provider selection

`VOICE_PROVIDER=vapi | agentcall`. When unset, Vapi is used if `VAPI_API_KEY` and `VAPI_PHONE_NUMBER_ID` are both
set; otherwise AgentCall, exactly as before. A chosen provider without its keys falls back to the mock caller.
Offline mode always uses the mock caller. The webhook URL is `VAPI_SERVER_URL`, else
`WAYFINDER_APP_BASE_URL`/`WAYFINDER_APP_ORIGIN`/`https://$VERCEL_PROJECT_PRODUCTION_URL` + `/api/webhooks/vapi`
(https only; without it no inline server is sent and the phone number's server URL is used).

## Setup

1. Create a Vapi account at dashboard.vapi.ai and add credit (calls bill per minute).
2. Buy a Vapi number, or import a Twilio number (Phone Numbers -> Import). Copy its **id** (not the number).
3. Set three env vars in Vercel (Production) and in `.env.local`:
   - `VAPI_API_KEY` (private key, dashboard -> API Keys)
   - `VAPI_PHONE_NUMBER_ID`
   - `VAPI_WEBHOOK_SECRET` (any long random value, e.g. `openssl rand -hex 32`)
4. Webhook URL: `https://wayfinder-amber-seven.vercel.app/api/webhooks/vapi`. Orelia sends it on every call, so
   nothing has to be registered. As a fallback, point the number at it too:
   `npx tsx scripts/configure-vapi-number.ts --base-url https://wayfinder-amber-seven.vercel.app --apply`.
5. Apply the migration: `npm run db:migrate` (adds `call_live` and `call_turns`).
6. Keep `OUTBOUND_ALLOWLIST` limited to test numbers. The adapter re-checks it.

### What is configured now (2026-10-24)

- Number `+16198262002` (Vapi-provided), id `49e55186-a4d6-4670-9f63-efcd6b9af24b`, status active, no assistant
  (Orelia sends an inline assistant per call). Every resource agent uses this one number for now; calls are told
  apart by their call records, not by number.
- `PATCH /phone-number/49e55186-...` set `server = { url: "https://wayfinder-amber-seven.vercel.app/api/webhooks/vapi",
  headers: { "x-vapi-secret": <VAPI_WEBHOOK_SECRET> }, timeoutSeconds: 20 }` (done with
  `scripts/configure-vapi-number.ts --apply`; the secret is the one in Vercel).
- Auth scheme: the `x-vapi-secret` header with the shared secret, which matches Vapi's documented
  "Legacy X-Vapi-Secret" form. A Vapi Bearer Token credential with header `x-vapi-secret` and no Bearer prefix, or
  `Authorization: Bearer <secret>`, also passes.
- `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET` (and the unused `VAPI_PUBLIC_KEY`) are set in Vercel
  Production.

## Cost notes

- Vapi: $0.05/min platform fee plus the speech-to-text, Claude, text-to-speech and telephony costs it passes through,
  so expect roughly $0.10 to $0.30 per minute in total. New accounts get $5 in credit. The base plan allows 4
  concurrent calls and includes 1 number. Check vapi.ai/pricing for current numbers.
- Claude tokens are billed through Vapi's Anthropic integration unless you add your own Anthropic credential in the
  Vapi dashboard (Provider Credentials), in which case they bill to that key.
- Calls are capped at 5 minutes (`maxDurationSeconds: 300`) and at most 5 active contacts per case.

## How to listen live

1. Approve a call to an allowlisted number. The judge view's live call data has `listenUrl` once Vapi reports the
   call (`GET /api/cases/{id}/calls/live?view=judge`).
2. Connect to the `wss://...` listen URL with any WebSocket client that plays raw PCM audio (Vapi streams 16-bit PCM),
   or open the call in the Vapi dashboard (Calls -> the live call -> Listen).
3. The transcript appears turn by turn in `call_turns` and the `/calls/live/stream` SSE feed while the call runs; the
   summary and tasks appear when the end-of-call report arrives.
