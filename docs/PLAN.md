# Wayfinder build plan

> Source of truth for every lane. HARD RULES below are non-negotiable.

## HARD RULES (every line of code, every milestone)
1. No medical advice. Find, contact, coordinate only. Never recommend treatments, interpret prognosis, or rank treatment options. If symptoms/urgency come up, the UI says "contact your care team or call 911."
2. Every claim shown about a resource must have an Evidence row with a source_url from a tool wrapper (never from a model). The verifier drops anything without one. Never let a model invent a credential or contact.
3. No real patient data. Synthetic reports in /fixtures only.
4. Nothing is ever sent to a real hospital, doctor, org or phone number during development or the demo. OutboundGate enforces OUTBOUND_ALLOWLIST (test AgentMail inboxes / phone numbers we own).
5. Human approval gates everything that leaves the system (approved_at timestamp from the user).
6. Minimum necessary: each message includes only the case fields the user ticked for it.
7. Outreach caps: max 5 active contacts per case, fixed follow-up cadence (business day 3 and 7, then stalled), AI-assistance disclosure in every outbound email and spoken at the start of every call.
8. Secrets live in .env.local; .env.example lists every variable.

Out of scope: pediatric cases, non-U.S. resources, EHR integration, fax, any medical recommendation.

## Working style
- Small commits per step, each with passing tests (`npm test`).
- Typed tool wrappers (lib/sources) stay separate from agent prompts.
- If an external API behaves differently than described, say so in your task summary and adapt; don't paper over it.
- Do not add dependencies beyond the approved list without asking the orchestrator (ronit-claude) via send_message.
- Only edit files your task owns; claim them with claim_files.

## Context
Wayfinder helps an adult with a rare disease get seen by the right people. The patient enters their case. A swarm of
research agents finds four kinds of resource: specialists and centers, recruiting clinical trials, patient advocacy
organizations, and financial or travel aid. The patient picks which resources to contact. Each picked resource then
gets its own **connection agent**, which emails it (AgentMail) or calls it (AgentCall), reads the replies, turns
requests into tasks the patient approves, and follows up until there is a connection: an appointment, trial screening,
membership or an aid application.

The pitch stays the same: *expert finders tell you who the expert is; Wayfinder gets you seen.*

This plan changes the original sarcoma spec in four ways, all from your answers:
- **Diseases:** any adult rare disease, not only rare cancers.
- **Resources:** four kinds of resource instead of experts only.
- **Outreach:** AgentMail and AgentCall replace patient Gmail. Phone was out of scope; calls are now in, allowlisted.
- **Search:** Exa covers sources that have no API.

All eight hard rules from your doc still apply. Pediatric cases, non-U.S. resources, EHR integration, fax and any
medical recommendation stay out of scope.

The repo is `~/wayfinder` (RonKat2008/wayfinder). It started as a TypeScript starter; it is now a Next.js app.

## Stack
- **App:** Next.js App Router with TypeScript, deployed on Vercel. Database is Neon Postgres with Drizzle ORM and
  migrations.
- **Models:** agents call the Anthropic Messages API through `@anthropic-ai/sdk`, using tool use
  (`lib/agents/runtime.ts`, `runAgent()`). The intake extractor and inbox classifier run on `claude-opus-5-5`.
  Research agents run in parallel on `claude-haiku-5-5`. The verifier is deterministic code, not a model.
  The Claude Agent SDK was removed: it runs a Claude Code subprocess, which does not fit Vercel functions.
- **Durable research:** Inngest runs each research pass as a `case/research.requested` event
  (`lib/workflows/research-workflow.ts`, served from `app/api/inngest`). Phases are queue, run-agents, verify,
  rank, persist, under one 180-second deadline.
- **Validation:** Zod for every agent's input and output. Agents return JSON only, and nothing is written to the
  database until it passes Zod.
- **Live updates:** server-sent events, read from `agent_runs`.
- **Tests:** Vitest. Recorded API responses live in `/fixtures/api`, and recorded model outputs in `/fixtures/llm`, so
  the whole flow runs offline with no keys.
- **Key dependencies:**

  | Package | Purpose |
  |---|---|
  | `agentmail` | Email: one inbox per case, plus webhooks for replies |
  | `exa-js` | Web search and page contents |
  | `inngest` | Durable follow-up timers (already "preferred" in your doc) |
  | `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless` | Database |
  | `zod` | Schemas |
  | `@anthropic-ai/sdk` | Agents (Messages API, tool use) |

  AgentCall has no SDK that I could verify, so it is called over REST with `fetch` and needs no package.

## Architecture
```
Intake (paste/upload) → Opus extracts the Case → patient confirms/edits
  → Orchestrator fans out the research swarm (parallel; every run is an agent_runs row, streamed over SSE)
      Literature (PubMed) · Trials (CT.gov v2) · Identity (NPPES) · Centers (NCI JSON + Exa)
      Advocacy (Exa) · Aid (Exa) · ContactFinder (Exa, intake doors only) · Network (stub) · Logistics (stub)
  → Verifier (deterministic): drops claims with no evidence, merges duplicates (NPI / NCT / URL / name), flags conflicts
  → Ranker (deterministic; weights in config/ranking.ts) → shortlist grouped by resource kind
  → Patient selects (≤5 active contacts) + consent (fields to share per contact)
  → One ConnectionAgent per contact (an Inngest workflow):
      draft (email or call script) → APPROVAL → OutboundGate → AgentMail / AgentCall
      → wait for reply/transcript or a timer (follow-ups at business days 3 and 7 after the first send;
        stalled at business day 10 with no reply)
  → InboxAgent classifies each reply or call transcript → tasks (referral, slides, records, call, redirect,
    unclear, declined) → patient approves → the connection agent continues
  → Tracker (every contact's state machine)
```
**OutboundGate (`lib/safety/outbound-gate.ts`)** is the one path out of the system, for both email and calls. It
refuses unless all of these hold:
- the message has `approved_at`;
- the address or number is on `OUTBOUND_ALLOWLIST` (dev and demo);
- the case has fewer than 5 active contacts;
- the follow-up cadence is respected;
- the body contains only the case fields the patient ticked, plus the AI-assistance disclosure.

For calls, that disclosure is spoken at the start. Unit tests cover every refusal path.

Current code details:
- The gate is `checkOutbound()`. It returns a `GatedDraft`, and the channel adapters (`lib/channels/agentmail.ts`,
  `agentcall.ts`) accept only that type (`assertGated`).
- The allowlist check is skipped only when `mode` is `prod` and `OUTBOUND_ALLOW_REAL=true`. Dev and demo always
  enforce it.
- Refusal reasons: `not_approved`, `invalid_draft`, `not_allowlisted`, `consent_mismatch`, `inactive_contact`,
  `contact_cap`, `follow_up_cadence`, `unshared_field`, `missing_disclosure`, `medical_advice`.
- Inbound webhooks are signature-checked: AgentMail uses Svix headers (`app/api/webhooks/agentmail`), and AgentCall
  uses an HMAC-SHA256 `X-AgentCall-Signature` (`app/api/webhooks/agentcall`).

## Planned (in progress, not in the code yet)
- **Curator:** a step after rank that tiers each resource as best, good, backup or exclude. Every tier carries
  evidence-cited reasons.
- **Neon AI Gateway:** one gateway layer with a model per role, configured in `config/models.ts`.
- **Case document embeddings:** a per-case pgvector store (`qwen3-embedding-0-6b`, 1024 dimensions). Outreach agents
  search it, and results are filtered by the contact's consent fields.

## File tree (target)
```
app/
  page.tsx                      intake: paste/upload report, confirm extracted Case
  cases/[id]/swarm/page.tsx     live swarm view (agent cards)
  cases/[id]/shortlist/page.tsx ranked resources by kind, reasons, evidence, select ≤5
  cases/[id]/consent/page.tsx   per-contact shared-field checkboxes            (M3)
  cases/[id]/outbox/page.tsx    approve drafted emails / call scripts           (M3)
  cases/[id]/tracker/page.tsx   contact states, tasks to approve                (M3)
  api/cases/route.ts, api/cases/[id]/research/route.ts, api/cases/[id]/stream/route.ts (SSE)
  api/webhooks/agentmail/route.ts, api/webhooks/agentcall/route.ts              (M3, signature-verified)
  api/inngest/route.ts                                                          (M3)
components/  swarm/AgentCard.tsx, shortlist/ResourceCard.tsx, EvidenceList.tsx, SafetyBanner.tsx ("contact your care team or call 911")
config/ranking.ts               weights (shown in the UI, tunable in M2)
db/schema.ts, db/client.ts, drizzle/ (migrations)
lib/contracts/                  Zod: case.ts, resource.ts, evidence.ts, agent-io.ts, message.ts, task.ts  ← FROZEN FIRST
lib/sources/                    typed wrappers, no prompts: pubmed.ts, ctgov.ts, nppes.ts, exa.ts, nci-centers.ts
                                (each: fetch fn + rate limiter + a FixtureTransport for offline mode)
lib/agents/                     orchestrator.ts, intake-extractor.ts, research/{literature,trials,identity,centers,
                                advocacy,aid,contact-finder,network,logistics}.ts, verifier.ts, connection.ts, inbox.ts
lib/agents/runtime.ts           runAgent(): Messages API tool-use loop (@anthropic-ai/sdk) → Zod parse → agent_runs bookkeeping;
                                offline replay from /fixtures/llm
lib/ranking/rank.ts             pure, deterministic; builds score_breakdown with evidence ids
lib/channels/                   types.ts (Channel interface), mock-mailer.ts, agentmail.ts, agentcall.ts, mock-caller.ts
lib/safety/                     outbound-gate.ts, allowlist.ts, minimize.ts, disclosure.ts, caps.ts, no-medical-advice.ts
lib/workflows/                  inngest client, connection-workflow.ts, business-days.ts            (M3)
data/nci-centers.json (+ source_url), data/test-allowlist.example.json
fixtures/reports/               3 synthetic reports: rare sarcoma, vascular EDS, rare autoimmune disease
fixtures/api/, fixtures/llm/    recorded responses
scripts/record-fixtures.ts, scripts/seed-demo.ts (M4), scripts/demo-coordinators.ts (M4)
tests/                          mirrors lib/
.env.example, README.md
```

## Data model (Drizzle) — generalized so M2–M4 add no rewrites
- **cases:** id, disease_name, disease_codes (jsonb: orpha / mesh / icd10), subtype, stage_summary, home_city,
  home_state, insurer, plan_id, travel_limit_miles, goals (text[]: second_opinion | treatment | trial | support | aid),
  status, created_at.
- **institutions:** id, name, kind (cancer_center | rare_disease_center | hospital), nci_designated, programs (jsonb),
  intake_url, intake_contact, city, state.
- **experts:** id, npi (unique, nullable), name, credentials, specialty, institution_id, disease_paper_count,
  recent_paper_count, trials_led, verified.
- **trials:** id, nct_id (unique), title, status, phase, sponsor, sites (jsonb), contacts (jsonb).
- **organizations:** id, kind (advocacy | financial_aid | travel_aid), name, url, services (jsonb), contact (jsonb).
- **Polymorphic targets:** the tables below point at a resource with `target_kind` (expert | institution | trial |
  organization) plus `target_id`, in place of `expert_id | institution_id` pairs.
  - **evidence:** id, target_kind, target_id, claim_type, claim, source_url NOT NULL, source_kind (pubmed | ctgov |
    nppes | nci | exa), fetched_at.
  - **case_candidates:** case_id, target_kind, target_id, rank, score, score_breakdown (jsonb with evidence ids),
    selected.
  - **contacts:** id, case_id, target_kind, target_id, channel (email | voice), address, state (drafted, sent,
    replied, task_open, records_sent, appointment_booked, connected, declined, stalled), next_follow_up_at,
    last_activity_at.
- **consents:** id, contact_id, shared_fields (text[]), approved_at (M3).
- **messages:** id, contact_id, direction, channel, provider_thread_id, provider_message_id, subject, body,
  shared_fields, approved_at, sent_at, received_at, classification.
- **calls:** id, contact_id, provider_call_id, to_number, script, approved_at, started_at, ended_at, transcript,
  outcome.
- **tasks:** id, contact_id, kind (referral | slides | records | call | redirect | unclear | declined), draft_body,
  due_at, status (open | approved | done).
- **reviews (M2):** id, case_id, target_kind, target_id, reviewer, verdict (correct | incorrect), note.
- **agent_runs:** id, case_id, agent, status (queued | running | done | failed | not_implemented), counts (jsonb),
  started_at, finished_at, error, output_summary.

## Agent interfaces (lib/contracts/agent-io.ts)
- **`ResearchAgent<I, O>`:**
  `{ name; model: 'claude-haiku-5-5'; input: ZodSchema<I>; output: ZodSchema<ResearchResult>; run(case, ctx) }`.
- **`ResearchResult`:** a union of `{ status: 'ok', records: Resource[], evidence: Evidence[] }`,
  `{ status: 'not_implemented' }` and `{ status: 'error', message }`. Every `Resource` carries `evidenceRefs[]`.
- **Tools are passed in.** The agent never fetches on its own; it calls the typed wrappers in `lib/sources`, and
  `source_url` comes from the wrapper, never from the model. Exa results become evidence only from URLs that Exa
  returned and the wrapper fetched.
- **`Verifier`:** `(ResearchResult[]) → { kept, dropped: {record, reason}[], merged, conflicts }`. Dropping claims
  that have no evidence is plain code, not the model, so the result is deterministic and testable. The orchestrator
  has an optional Opus `proposer` hook for merges and conflicts, but the app does not wire it.
- **`rank(candidates, weights)`:** a pure function returning `Ranked[]` with `breakdown: {factor, points, text,
  evidenceIds}[]`.
- **`ConnectionAgent`:** `draft(contact, consent) → Draft` (an email or a call script), `onInbound(event) →
  Classification` (handled by the InboxAgent), `nextAction(state) → FollowUp | Close`.
- **`Channel`:** `{ kind: 'email' | 'voice'; send(gatedDraft) → ProviderRef }`. Implementations are MockMailer and
  MockCaller (M1 and tests), and AgentMail and AgentCall (M3, used only through OutboundGate).

## Milestones (each one is a gate: tests green, then an Opus safety/code review, then merge)
1. **Intake to a verified, ranked shortlist, streamed live, fully offline from fixtures.**
   - All nine agent cards appear; Network and Logistics return `not_implemented`.
   - Contact finder is a stub in M1.
   - **Done when** the demo case returns a shortlist in under 3 minutes, and every displayed claim links to its
     `source_url`.
2. **Contact finder, review and tuning.**
   - Contact finder goes live: it uses Exa to find intake doors (new-patient line, referral coordinator,
     second-opinion program, navigator) and never personal emails.
   - Logistics: in-state check plus a licensure flag for virtual visits. Distance waits until you approve a geocoding
     source.
   - Network: stays a stub that answers "unknown". FHIR directories are flaky, so I'll report what they actually do
     before building on them.
   - The UI gets tunable ranking weights and a reviewer checkpoint that writes to `reviews`.
3. **The outreach loop.**
   - Consent screen and drafts for both email and call scripts.
   - Approval goes through OutboundGate to AgentMail (one inbox per case) or AgentCall.
   - Webhooks bring in replies and call transcripts, and the InboxAgent turns them into tasks.
   - Inngest drives follow-ups at business day 3 and day 7, then marks the contact `stalled` at business day 10.
   - A tracker page shows every contact's state.
4. **Demo.**
   - `seed-demo.ts` creates AgentMail inboxes that pose as intake coordinators. `demo-coordinators.ts` sends scripted
     replies, including "please send slides".
   - AgentCall dials only a phone number you own.
   - Simulated time triggers the day-3 follow-up.
   - The steps follow your six-step demo script.

## Team lanes (agentteams: ronit-claude = orchestrator, ronit-codex, ronit-cursor)
- **Lane 0, me, serial, before anything else:**
  - Convert the repo to Next.js; add the Drizzle schema and first migration, `lib/contracts`, a `lib/safety`
    skeleton, `.env.example` and the lint and test scripts.
  - Run `scripts/record-fixtures.ts` against the live APIs. Codex's sandbox has no network, so recording happens
    here.
  - Freeze the contracts, commit, and push.
- **Board tasks:** I create them through the agentteams MCP with a small stdio client script in the scratchpad. This
  session started outside the repo, so its MCP isn't loaded. Workers start with
  `agentteams run <task> --detach --agent codex|cursor`. Each task gets its own worktree and branch, and claims its
  files.
- **The lanes:**

  | Lane | Worker | Owns |
  |---|---|---|
  | A | **Codex** | `lib/sources/*` wrappers and their tests against `/fixtures/api` (pure TS, no network needed); `lib/ranking`; `lib/workflows/business-days.ts` |
  | B | **Cursor** | All of `app/` and `components/`: intake, swarm view (SSE client), shortlist, then consent, outbox and tracker in M3; plus the SafetyBanner |
  | C | Claude subagent (sonnet), in a worktree | `lib/agents/*`, `runtime.ts`, orchestrator fan-out, verifier, SSE route |
  | D | Claude subagent (sonnet), M3 | `lib/channels/*`, webhooks, Inngest workflows, InboxAgent |
  | E | Claude subagent (opus), at each gate | Safety and security review of OutboundGate, webhooks and the allowlist; checks for medical-advice leaks |

- **steelzx-claude:** gets no work unless you tell me who they are.
- **Merging:** at each gate I run `agentteams merge --test "npm test"`, verify the result myself and push.

## Test strategy
- **Tool wrappers:** each one is tested against recorded fixtures, covering parsing, pagination, the rate limiter and
  error shapes.
- **Verifier:** a test proves it drops every record or claim without a `source_url`, and that it merges duplicates by
  NPI.
- **Ranking:** a snapshot test shows a fixed input gives the same order and breakdown every time.
- **Safety:** OutboundGate has a test for each refusal: not approved, not on the allowlist, over the cap, a field not
  ticked, missing disclosure, follow-up cadence. Tests also cover `minimize()` and the no-medical-advice output filter
  for agent text.
- **Contracts:** every agent's output fixture parses against its Zod schema.
- **Workflows (M3):** the business-day math, and the connection state machine run with a fake clock.
- **Offline end to end:** `npm run demo:offline -- --all` (or `--case <slug>`) runs intake through shortlist, and the
  M3/M4 loop with MockMailer/MockCaller, from fixtures. It asserts every displayed claim has an evidence URL.
  `WAYFINDER_OFFLINE=1` replays `fixtures/api` and `fixtures/llm`. `runAgent()` also replays when no
  `ANTHROPIC_API_KEY` is set. The demo is described in `docs/DEMO.md`.
- **UI:** I check it by hand with Claude in Chrome. Playwright isn't in your stack, so I'll ask before adding it.

## Verification (per gate)
1. `npm run lint && npm run typecheck && npm test`.
2. `npm run demo:offline`: time it (the M1 target is under 3 minutes) and check the evidence assertions.
3. `npm run dev`, then drive the flow in Chrome. Click evidence links and confirm they open real source pages.
4. From M3: send to allowlisted AgentMail inboxes only. Confirm OutboundGate refuses a non-allowlisted address in a
   live run. Make a call to your own number.

## Things I need from you during the build
- **Keys in `.env.local`:**
  - `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `NCBI_API_KEY` (optional), Neon `DATABASE_URL`.
  - From M3: `AGENTMAIL_API_KEY`, `AGENTCALL_API_KEY`, plus a test phone number you own.
- **Neon:** I can create the project through the Neon MCP if you want.

## Risks I'll report rather than paper over
- **Agent SDK on Vercel (resolved):** the Agent SDK runs a Claude Code subprocess, which does not fit Vercel functions.
  It was removed. Agents now run on `@anthropic-ai/sdk` Messages tool use.
- **AgentCall:** its docs were thin in my search. I'll confirm the REST shape and webhook signing before Lane D starts.
- **Exa evidence quality:** an Exa result counts as evidence only if the page we fetched contains the claim. The
  verifier checks for that.
