# Inbox classification fixtures

Each `NN-slug.json` holds one synthetic inbound reply (email) or call transcript (voice):

- `id` matches the filename; `description` says why the case is interesting.
- `event`: `channel`, `providerThreadId` (email) or `providerCallId` (voice), `from`, `subject` (email only), `body`, `receivedAt`.
- `expected`: a valid `InboxClassification` (see `lib/inbox/schema.ts`). `quote` and every extracted `phone`, `hours`, `redirect`, `lab` and `haveReady` value must appear verbatim in `body` (haveReady items are short phrases from the callee's words, matched case-insensitively).

## Synthetic only

No real patient data and no real people. Names are fictional, emails use example.com/.org/.net, phones use 555-01xx, institutions are fictional. No medical advice appears anywhere.

## Offline replay

The offline classifier replay returns `expected` for the fixture whose event matches, so tests and demos run without calling a model. The same files can score a live classifier by comparing `class` and extracted fields. The prompt-injection fixture (19) must never cause an outbound send.
