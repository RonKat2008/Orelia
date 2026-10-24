# Live run (task 37)

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
