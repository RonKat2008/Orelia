# Live run (task 42)

Sequential `npx tsx scripts/live-run.ts --all` on 2026-10-24. Synthetic reports only (`fixtures/reports`). Neon AI Gateway was on. `WAYFINDER_OFFLINE` was unset. `WAYFINDER_RECORD_LLM` was unset, so `fixtures/llm` was not rewritten. AgentMail and AgentCall keys were removed for the process. No email was sent and no call was placed.

`FetchTransport` now shares one process-wide limiter per host: PubMed 3 requests/second without `api_key` and 10/second with `NCBI_API_KEY`, NPPES 3/second, ClinicalTrials.gov 3/second. HTTP 429 is retried up to three times using `Retry-After` or exponential backoff. Failures report status and endpoint. The NCBI `api-key` field (a caller address) and query-string keys are not copied into the error.

The run recorded no HTTP drift (no 429s and no JSON-shape errors) from PubMed, ClinicalTrials.gov, NPPES, or Exa. Every research agent finished `done`. `contact_finder`, `network`, and `logistics` are still `not_implemented`. Curator ran (the untagged Opus call in the ledger).

Verifier results and the shortlist were not returned. `runResearch` threw while inserting `case_documents` embeddings (`qwen3-embedding-0-6b` vectors) after the agents finished, so `verify` and `shortlist` stayed empty. Identity's run summary was only a record count, not NPI values. Because this pass could not show a live shortlist at least as good as the offline one (verified experts, every claim sourced), `fixtures/llm` was left as it is.

Costs are estimates from gateway `usage`. Haiku 4.5 list price is $1 / $5 per million input/output tokens. Cache writes are priced at 1.25× input and cache reads at 0.1× input. Opus 5.5 uses the Opus 4.1 stand-in ($15 / $75 per million).

## Epithelioid sarcoma

Extract 5.1s. Research through curator 67.7s (swarm wall 64.9s). Estimate **$0.727**. Identity: done, 6.2s, summary `6 records, 6 evidence`.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 5.1s | 1 | 1496 / 435 / 0 | 0.069 |
| literature | done | 7.0s | 1 | 2584 / 1430 / 0 | 0.010 |
| trials | done | 3.1s | 1 | 2535 / 525 / 0 | 0.005 |
| identity | done | 6.2s | 1 | 3657 / 1264 / 0 | 0.010 |
| centers | done | 8.1s | 1 | 4389 / 1572 / 0 | 0.012 |
| advocacy | done | 21.3s | 3 | 33570 / 1597 / 0 | 0.042 |
| aid | done | 5.6s | 1 | 3363 / 834 / 0 | 0.008 |
| curator | done | 42.3s | 1 | 12858 / 4770 / 0 | 0.572 |

## Vascular Ehlers-Danlos syndrome

Extract 4.4s. Research through curator 50.5s (swarm wall 48.9s). Estimate **$0.591**. Identity: done, 5.2s, summary `5 records, 5 evidence`.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 4.4s | 1 | 1388 / 345 / 719 | 0.048 |
| literature | done | 7.5s | 1 | 3532 / 1418 / 0 | 0.011 |
| trials | done | 4.5s | 1 | 1995 / 1001 / 0 | 0.007 |
| identity | done | 5.2s | 1 | 2426 / 1277 / 0 | 0.009 |
| centers | done | 8.6s | 1 | 3915 / 1555 / 0 | 0.012 |
| advocacy | done | 4.9s | 1 | 3426 / 731 / 0 | 0.007 |
| aid | done | 12.8s | 2 | 12681 / 981 / 0 | 0.018 |
| curator | done | 33.0s | 1 | 10486 / 4013 / 0 | 0.480 |

## IgG4-related disease

Extract 5.0s. Research through curator 38.1s (swarm wall 36.1s). Estimate **$0.428**. Identity: done, 5.4s, summary `6 records, 6 evidence`.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 5.0s | 1 | 1329 / 491 / 0 | 0.070 |
| literature | done | 8.4s | 1 | 3215 / 1920 / 0 | 0.013 |
| trials | done | 2.6s | 1 | 1866 / 474 / 0 | 0.004 |
| identity | done | 5.4s | 1 | 2363 / 1250 / 0 | 0.009 |
| centers | done | 7.4s | 1 | 3911 / 1333 / 0 | 0.011 |
| advocacy | done | 5.1s | 1 | 3405 / 409 / 0 | 0.005 |
| aid | done | 3.6s | 1 | 3799 / 549 / 0 | 0.007 |
| curator | done | 24.6s | 1 | 6309 / 2842 / 1165 | 0.310 |

## Identity

Offline fixtures still verify experts. Live identity previously cleared every NPI when PubMed listed the same person more than once (for example `Jerad` and `Jerad M`), because that was treated as a truncated registry lookup and the affiliation was dropped before the NPPES row was scored. Those rows are now one author unless the middle initials conflict. A regression test replays `fixtures/api/nppes/live-gardner.json` (recorded from the NPPES API) through `createLivePorts` and expects NPI `1568608651`.
