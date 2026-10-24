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

---

# Earlier live run (task 37, recorded the current fixtures/llm)

Synthetic reports only (`fixtures/reports`). Neon AI Gateway was on (`NEON_AI_GATEWAY_BASE_URL` + token). `WAYFINDER_OFFLINE` was unset. `WAYFINDER_RECORD_LLM=1` rewrote `fixtures/llm/<agent>/<slug>.json` for each successful agent. AgentMail and AgentCall keys were not set. No email was sent and no call was placed. `NCBI_API_KEY` was empty, so PubMed was limited to 3 requests/second per process.

Verifier is deterministic and was not a model call. `lib/agents/curator.ts` is not in this tree, so there was no curate step. `contact_finder`, `network`, and `logistics` are still `not_implemented`.

Models actually called: intake `claude-opus-5-5`, research `claude-haiku-4-5` (gateway branch in `config/models.ts`). Direct Anthropic defaults would use `claude-haiku-5-5` for research. PLAN.md still names Haiku 5.5 for research.

Costs are estimates from gateway `usage` fields, not an invoice. Haiku 4.5 list price is $1 / $5 per million input/output tokens. Cache writes are priced at 1.25× input and cache reads at 0.1× input. Opus 5.5 has no confirmed public list price; intake dollars use the Opus 4.1 stand-in ($15 / $75 per million).

A first parallel pass of all three cases shared one unkeyed NCBI IP quota. PubMed returned HTTP 429 with JSON `{error: "API rate limit exceeded", count: "4", limit: "3"}`. The `api-key` field was the caller IP, not a key. `FetchTransport` throws `http: Request failed` and does not put `SourceError.status` or the body on the message, so the agent row cannot tell a 429 from any other HTTP failure. That pass failed `identity` on epithelioid sarcoma and `literature` on IgG4-related disease. The numbers below are later single-process runs, which did not 429.

`WAYFINDER_OFFLINE=1 npx tsx scripts/demo-offline.ts --all` exited 0 on the new fixtures. Replay still finalizes some literature and identity outputs to 0 records, because provenance is checked against tool results rather than the saved JSON alone. Centers, trials, advocacy, and aid still produced a shortlist.

## Epithelioid sarcoma

Extract 4.8s. Research + verify + rank 16.0s (swarm wall 16.0s; verify/rank/persist tail ~8ms). Estimate **$0.136**.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 4.8s | 1 | 1496 / 432 / 641 | 0.056 |
| literature | done | 4.6s | 1 | 2457 / 831 / 0 | 0.007 |
| trials | done | 3.3s | 1 | 2408 / 521 / 0 | 0.005 |
| identity | done | 5.4s | 1 | 3601 / 1257 / 0 | 0.010 |
| centers | done | 8.7s | 1 | 4132 / 1779 / 0 | 0.013 |
| advocacy | done | 15.8s | 3 | 31345 / 1067 / 0 | 0.037 |
| aid | done | 6.4s | 1 | 3091 / 1076 / 0 | 0.008 |

Verifier kept 25, dropped 0, merged 3, conflicts 0. Shortlist: institution 9, organization 8, trial 2. No expert rows. Identity's recorded JSON left `npi` null, and `expertEligibility` requires a verified NPI plus a paper threshold, so those records stay off the patient-facing shortlist.

## Vascular Ehlers-Danlos syndrome

Extract 5.6s. Research + verify + rank 33.0s (tail ~15ms). Estimate **$0.185**.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 5.6s | 1 | 1388 / 440 / 641 | 0.055 |
| literature | done | 8.1s | 1 | 3405 / 1853 / 0 | 0.013 |
| trials | done | 4.6s | 1 | 1868 / 1006 / 0 | 0.007 |
| identity | done | 5.2s | 1 | 2370 / 1179 / 0 | 0.008 |
| centers | done | 8.7s | 1 | 3544 / 1623 / 0 | 0.012 |
| advocacy | done | 12.0s | 2 | 11505 / 1391 / 0 | 0.018 |
| aid | done | 32.6s | 4 | 63395 / 1822 / 0 | 0.073 |

Verifier kept 26, dropped 3, merged 1. Shortlist: institution 8, organization 11, trial 2. No experts (same NPI gate). Dropped trials, all `off-target` because the disease string is not in conditions, keywords, MeSH, or title: NCT04806620, NCT07464093, NCT02050113. ClinicalTrials.gov v2 still returned those studies for the condition query. The search is wider than the verifier's phrase check. No HTTP or JSON-shape errors from PubMed, CT.gov, NPPES, or Exa on this run.

## IgG4-related disease

Extract 6.1s. Research + verify + rank 13.8s (tail ~15ms). Estimate **$0.101**.

| Agent | Status | Wall | Model calls | Tokens in / out / cache read | USD |
| --- | --- | --- | --- | --- | --- |
| intake-extractor | done | 6.1s | 1 | 1329 / 487 / 641 | 0.057 |
| literature | done | 6.3s | 1 | 3088 / 1291 / 0 | 0.010 |
| trials | done | 3.0s | 1 | 1739 / 486 / 0 | 0.004 |
| identity | done | 6.2s | 1 | 2307 / 1264 / 0 | 0.009 |
| centers | done | 9.0s | 1 | 3563 / 1399 / 0 | 0.011 |
| advocacy | done | 2.8s | 1 | 3171 / 389 / 0 | 0.005 |
| aid | done | 4.8s | 1 | 3454 / 518 / 0 | 0.006 |

Verifier kept 16, dropped 2, merged 2. Shortlist: institution 6, organization 4. Both recruiting hits were dropped as off-target (NCT07061938, NCT07190196), so this case has no trial on the shortlist. No experts, for the same NPI reason.

## API drift

- Gateway routing works: Anthropic-compatible `/anthropic` messages returned `usage` (including cache read of 641 tokens on intake). Research model id is `claude-haiku-4-5`, not `claude-haiku-5-5`.
- PubMed 429 body is `{error, api-key, count, limit}` with string counts and `api-key` set to an IP. Callers only see `http: Request failed`.
- CT.gov v2 `studies` JSON matches what `CtgovClient` reads. Several hits do not contain the disease phrase in the fields `assessTrial` checks, so they are dropped after a successful search.
- NPPES and Exa returned the expected `results` objects on the clean runs. Identity still did not emit a verified NPI, so nothing became an expert shortlist row.
- No curator module to compare with the plan's curate step.
