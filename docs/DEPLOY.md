# Deploying Wayfinder (Vercel + Neon + Inngest + AgentMail + AgentCall)

Hand-run checklist for the dashboard work. No credentials live in this file: paste secrets only into the Vercel
dashboard / `vercel env add`, never into git. Replace `<domain>` with the production domain (for example
`wayfinder.vercel.app`) everywhere below.

Items marked **(verify)** could not be confirmed from the repo and need a quick check against the live dashboard or
the merged code.

## 1. Overview and what "done" looks like

```
GitHub (RonKat2008/wayfinder) -> Vercel (Next.js) -> Neon Postgres (Drizzle)
                                    |-> /api/inngest          <- Inngest cloud calls in (research, connection, follow-up)
                                    |-> /api/webhooks/agentmail  <- AgentMail (Svix) replies
                                    '-> /api/webhooks/agentcall  <- AgentCall call transcripts / status
```

**Done means all three of these pass:**

1. `GET https://<domain>/api/health` returns HTTP 200 with `"ok": true` and nothing missing.
2. An offline demo case runs end to end (intake -> shortlist) on the deployed site.
3. One send to an allowlisted test inbox that we own works, and a send to a non-allowlisted address is refused.

**HARD RULE 4 (docs/PLAN.md): during the hackathon and demo, nothing may be sent to a real hospital, doctor,
organization or phone.**

- `OUTBOUND_ALLOWLIST` contains only test AgentMail inboxes and phone numbers we own.
- `OUTBOUND_ALLOW_REAL` stays **unset** in every environment. Never set it to `true`.
- The seeded demo "coordinators" are fictional AgentMail inboxes (see docs/DEMO.md).

## 2. Prerequisites

Accounts (all can be free tier; no credentials go in this doc):

| Service | Needed for | Notes |
|---|---|---|
| GitHub | Source | Access to `RonKat2008/wayfinder` |
| Vercel | Hosting | Team/hobby account that can import the repo |
| Neon | Postgres | Needs the `vector` extension (migration `0025_case_documents.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`; Neon supports pgvector) |
| Inngest | Durable workflows | Free plan is fine |
| AgentMail | Email + reply webhooks | Free plan: 3 inboxes, 100 emails/day (docs/integrations/agentmail.md) |
| AgentCall | Voice (optional for demo) | https://agentcall.co (not AgentPhone). Need a number id `num_...` |
| Anthropic **or** Neon AI Gateway | Models | Either `ANTHROPIC_API_KEY`, or both `NEON_AI_GATEWAY_BASE_URL` and `NEON_AI_GATEWAY_TOKEN` |
| Exa | Web search for research agents | Required in production |

Local tools: Node 22+ (`engines` is `>=22`; Vercel runs 24), npm, `jq`, `openssl`, and optionally the Vercel CLI
(`npm i -g vercel`).

## 3. Create the Vercel project

1. Vercel dashboard -> **Add New... -> Project** -> **Import Git Repository** -> pick `RonKat2008/wayfinder`.
2. **Framework Preset:** should auto-detect **Next.js**. Leave Build Command and Output Directory on defaults in the
   UI (the build command comes from `vercel.ts`, see below).
3. **Root Directory:** `./` (repo root).
4. **Node.js Version:** Project -> Settings -> General -> Node.js Version -> **24.x**.
5. Do **not** click Deploy yet. Expand **Environment Variables** and add them first (section 4), or click Deploy and
   expect the first production build to fail with the check-env error (that is by design, see section 9).

**How `vercel.ts` is picked up:** Vercel reads a `vercel.ts` at the repo root automatically, with no dashboard
setting (it is compiled to `vercel.json` using the `@vercel/config` devDependency). It supplies the security
headers (CSP, HSTS, etc.), the function `maxDuration`s, and this build command:

```
if [ "$VERCEL_ENV" = "production" ]; then npx tsx scripts/check-env.ts --strict; else npx tsx scripts/check-env.ts; fi && next build
```

So **production** builds run `check-env --strict`: a missing required variable fails the build on purpose, so a
broken config never goes live. Preview builds only print the report and are never blocked. Do not override the Build
Command in the Vercel UI, or `vercel.ts` is bypassed. Confirm `vercel.ts` exists on the branch Vercel builds.

CLI alternative:

```bash
vercel link          # pick the team and the wayfinder project
```

## 4. Environment variables

Set in Project -> Settings -> **Environment Variables**. Tick the environments in the table.
P = Production, Pr = Preview, D = Development. Names only below; never commit values.

| Variable | P | Pr | D | Where to get it / notes |
|---|---|---|---|---|
| `DATABASE_URL` | yes | yes | yes | Neon -> Dashboard -> Connect -> pooled connection string (`postgresql://...neon.tech/...?sslmode=require`). Use a separate Neon branch for Preview. |
| `ANTHROPIC_API_KEY` | one of | one of | one of | console.anthropic.com -> API keys. Skip if using the Neon AI Gateway. |
| `NEON_AI_GATEWAY_BASE_URL` | one of | one of | one of | Neon AI Gateway base URL. Set **together with** the token, or not at all (gateway needs both). |
| `NEON_AI_GATEWAY_TOKEN` | one of | one of | one of | Neon AI Gateway token. Mark Sensitive. |
| `EXA_API_KEY` | yes | yes | optional | dashboard.exa.ai -> API keys. Required in prod, optional in demo mode. |
| `NCBI_API_KEY` | optional | optional | optional | NCBI account settings. Raises PubMed rate limit; app works without it. |
| `INNGEST_EVENT_KEY` | yes | yes | no | Inngest -> Manage -> Event Keys (section 6). |
| `INNGEST_SIGNING_KEY` | yes | yes | no | Inngest -> Manage -> Signing Key (section 6). Starts with `signkey-`. |
| `AGENTMAIL_API_KEY` | yes | yes | optional | console.agentmail.to -> API Keys. Leave empty locally for dry-run mode. |
| `AGENTMAIL_WEBHOOK_SECRET` | yes | yes | no | AgentMail webhook page after creating the webhook (section 7). Looks like `whsec_...`. Required in prod; in demo mode required once `AGENTMAIL_API_KEY` is set. |
| `AGENTCALL_API_KEY` | if calls | if calls | optional | agentcall.co dashboard. Looks like `ac_live_...`. Skip entirely if not demoing voice. |
| `AGENTCALL_WEBHOOK_SECRET` | yes (prod) | if calls | no | AgentCall webhook settings (section 7). Required in **prod mode even without calls** (put a generated placeholder if you have no AgentCall account, e.g. `openssl rand -hex 32`, so the route rejects everything); in demo mode required only when `AGENTCALL_API_KEY` is set. |
| `AGENTCALL_FROM_NUMBER_ID` | if calls | if calls | optional | A **number id** like `num_abc123`, NOT a phone number. Required whenever `AGENTCALL_API_KEY` is set. |
| `OUTBOUND_ALLOWLIST` | yes | yes | yes | Comma-separated, no spaces needed: emails and E.164 phones **we own**, e.g. `coord1@agentmail.to,+15555550100`. Exact entries are what `seed-demo.ts` prints. |
| `OUTBOUND_ALLOW_REAL` | **unset** | **unset** | **unset** | Never set. Real sends are only ever possible when this is `true` **and** mode is prod. Keep it absent (do not even create it empty). |
| `WAYFINDER_SESSION_SECRET` | yes | yes | yes | `openssl rand -base64 32`. Use a different value per environment. |
| `WAYFINDER_MODE` | demo (hackathon) | optional | optional | `offline` / `dev` / `demo` / `prod`. See mode note below. |
| `WAYFINDER_DEMO` | optional | optional | optional | `1` enables the `/demo` control panel and `/api/demo/*`. Leave unset on a real prod. |
| `WAYFINDER_OFFLINE` | unset | optional | optional | `1` replays recorded fixtures with no live API calls. For rehearsal only. |
| `WAYFINDER_SIM_TIME_SCALE` | **never** | demo previews only | optional | e.g. `1440` = one business day per real minute (docs/DEMO.md). Demo previews only; never on production. |
| `DEMO_REPLY_ALLOWLIST` | demo only | demo only | optional | Our own case inbox address; limits who the fictional coordinators may reply to. |
| `WAYFINDER_MODEL_ORCHESTRATOR`, `_INTAKE`, `_VERIFIER`, `_INBOX`, `_CURATOR`, `_RESEARCH`, `_EMBEDDING` | optional | optional | optional | Per-role model overrides (`config/models.ts`). Leave unset for defaults. |

Auto-provided by Vercel (do not set): `VERCEL_ENV`, `VERCEL_URL`, `NODE_ENV`.

**Mode note.** Mode is resolved (`resolveMode` in `lib/env.ts`), first match wins: `WAYFINDER_MODE` (offline|dev|demo|prod) ->
`WAYFINDER_OFFLINE=1` => `offline` -> `VERCEL_ENV=production` => `prod` -> `WAYFINDER_DEMO=1` => `demo` -> else
`dev`. So Vercel **Production is `prod`** unless `WAYFINDER_MODE` is set, and Vercel **Preview is `dev`** (not
blocked, reports only) unless `WAYFINDER_DEMO=1`. For the hackathon deployment set `WAYFINDER_MODE=demo` on
Production: EXA and the webhook secrets stop being hard requirements (webhook secrets are required only when the
matching API key is set), and the allowlist is still required and enforced. In every mode the allowlist is enforced
unless mode is `prod` **and** `OUTBOUND_ALLOW_REAL=true`.

Required for a green production build/health in **prod** mode: `DATABASE_URL`, model access (`ANTHROPIC_API_KEY` or
both `NEON_AI_GATEWAY_*`; reported as `MODEL_ACCESS`), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`,
`AGENTMAIL_WEBHOOK_SECRET`, `AGENTCALL_WEBHOOK_SECRET`, `EXA_API_KEY`, `WAYFINDER_SESSION_SECRET`,
`OUTBOUND_ALLOWLIST`. **demo** mode requires the same minus `EXA_API_KEY`, and the two webhook secrets only when the
matching API key is set. **dev/offline** require nothing.

Tip: mark all keys/secrets **Sensitive** in the Vercel UI.

### CLI alternative

```bash
vercel env add DATABASE_URL production          # paste when prompted; repeat per var / environment
vercel env add DATABASE_URL preview
vercel env add OUTBOUND_ALLOWLIST production
vercel env ls                                    # names + environments only
vercel env pull .env.local                       # writes Development vars to .env.local (gitignored)
```

Generate the session secret and pipe it in without it hitting your shell history:

```bash
openssl rand -base64 32 | vercel env add WAYFINDER_SESSION_SECRET production
```

### Check locally before deploying

```bash
vercel env pull .env.local --environment=production   # sensitive vars may come back empty; that is expected
npx tsx scripts/check-env.ts --mode prod --strict    # exit 1 if a required var is missing; prints names only
npx tsx scripts/check-env.ts --mode demo --strict    # what the hackathon (WAYFINDER_MODE=demo) deployment needs
```

## 5. Database (Neon)

Run migrations from your laptop **before the first production deploy**, and again after every merge that adds files
under `drizzle/`.

1. In Neon create a project (Postgres 17 or 16). Copy the **direct** connection string for migrations (the unpooled
   one is safest for DDL; the pooled one is used at runtime). **(verify: pooled works for drizzle-kit migrate; if it
   errors, use unpooled.)**
2. Run:

```bash
cd wayfinder
npm ci
DATABASE_URL='postgresql://USER:PASSWORD@HOST/DB?sslmode=require' npm run db:migrate
```

   This applies, in order: `0000_tense_medusa`, `0001_contact_follow_up_columns`, `0002_case_candidate_tiers`,
   `0025_case_documents` (enables `pgvector`).
3. Verify (any one):

```bash
psql "$DATABASE_URL" -c '\dt'                         # expect cases, contacts, messages, calls, tasks, agent_runs, ...
psql "$DATABASE_URL" -c '\dx' | grep vector            # pgvector installed
psql "$DATABASE_URL" -c 'select * from drizzle.__drizzle_migrations;'
```

   Or Neon console -> Tables. After deploy, `/api/health` should report `"db": "up"`.
4. Use a separate Neon branch (and `DATABASE_URL`) for Preview so previews never touch production data. Migrate
   that branch the same way.

If `0025_case_documents` fails on `CREATE EXTENSION`, run `CREATE EXTENSION vector;` once in the Neon SQL editor and
retry.

## 6. Inngest

Research (`case/research.requested`), connection and follow-up workflows all run on Inngest. The app is served from
`/api/inngest` (`app/api/inngest/route.ts`, `maxDuration = 300`); the client id is `wayfinder`.

1. app.inngest.com -> sign up -> create an environment (use **Production**).
2. **Manage -> Event Keys** -> create a key -> copy to Vercel as `INNGEST_EVENT_KEY` (Production + Preview).
3. **Manage -> Signing Key** -> copy to Vercel as `INNGEST_SIGNING_KEY` (Production + Preview). For Preview, use the
   Inngest "Branch" environment key if you want isolated previews. **(verify)**
4. Redeploy so the new vars take effect (section 8).
5. **Apps -> Sync new app -> Sync manually** with URL:

```
https://<domain>/api/inngest
```

   (Alternatively install the Vercel integration for Inngest, which syncs on every deploy. **(verify)**)
6. If the site is behind Vercel Deployment Protection, either disable it for Production or add the Inngest
   protection bypass; an unreachable URL fails the sync with a 401/403.
7. Verify: Inngest -> **Apps -> wayfinder** shows these functions:
   - `contact-connection` (trigger: contact approved)
   - `contact-follow-up-send` (trigger: follow-up approved)
   - `research-case` (trigger: `case/research.requested`)

   Quick check from a terminal (shows function registration, no secrets):

```bash
curl -s https://<domain>/api/inngest | jq
```

   Expect `"function_count": 3` and `"has_event_key": true`, `"has_signing_key": true` **(verify field names for
   inngest 4.26)**.

## 7. AgentMail and AgentCall webhooks

### AgentMail (email replies)

1. console.agentmail.to -> **Webhooks** -> **Add endpoint**.
2. URL:

```
https://<domain>/api/webhooks/agentmail
```

3. Events: **`message.received`** only. The handler ignores everything else (returns 200 `ignored`), so extra
   events are harmless but unnecessary.
4. After saving, copy the signing secret (`whsec_...`) into Vercel as `AGENTMAIL_WEBHOOK_SECRET` (Production +
   Preview) and redeploy.
5. Create the test inboxes we own (section 8) via the seeding script; those addresses go into
   `OUTBOUND_ALLOWLIST`.

Signing: Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`), 5-minute tolerance. docs/integrations/agentmail.md
notes the exact Svix scheme is still UNVERIFIED against a real delivery, so test one reply (section 8).

### AgentCall (voice; optional for the demo)

1. agentcall.co dashboard -> **Webhooks** (post-call webhook). **(verify exact menu name)**
2. URL:

```
https://<domain>/api/webhooks/agentcall
```

3. Events: **`call.transcript`** and **`call.status`** (the handler stores both; `call.report.ready`,
   `call.recording`, `transcript.partial` are ignored with 200).
4. Copy the signing secret into Vercel as `AGENTCALL_WEBHOOK_SECRET` (header used: `X-AgentCall-Signature:
   sha256=<hex>`).
5. **Numbers** page -> copy the number **id** (`num_...`, not the phone number) into Vercel as
   `AGENTCALL_FROM_NUMBER_ID`. Put only a phone we own (E.164, e.g. `+15555550100`) in `OUTBOUND_ALLOWLIST`.
6. Docs/integrations/agentcall.md lists several UNVERIFIED API assumptions; do not place a live call until the
   response shape is confirmed against https://api.agentcall.co/docs.

## 8. Deploy and smoke checks

### Deploy

1. Confirm all required env vars are set for Production (section 4) and migrations are applied (section 5).
2. Trigger the deploy: push/merge to the production branch (`main`), or Vercel -> Deployments -> **Redeploy**.
   CLI: `vercel --prod`.
3. Watch the build log. The first line of `check-env --strict` output lists any missing names.

### Smoke checks

```bash
export DOMAIN=<domain>
curl -s https://$DOMAIN/api/health | jq
```

Expected (green):

```json
{
  "ok": true,
  "mode": "demo",
  "db": "up",
  "gateway": "not",
  "modelAccess": "anthropic",
  "inngest": "configured",
  "outbound": "allowlist",
  "env": { "ok": true, "missing": [] },
  "version": "abc1234"
}
```

Field values: `db` is `up` / `down` / `not_configured`; `gateway` and `inngest` are `configured` / `not`;
`modelAccess` is `gateway` / `anthropic` / `none`; `outbound` is `allowlist` (what we want) or `real` (**stop and
unset `OUTBOUND_ALLOW_REAL`**); `gateway` shows `configured` only when using the Neon AI Gateway. The response is 503
when `db` is `down` or `env.ok` is false (`env.missing` lists the names). It never includes secret values.

**Offline demo case.** Quickest proof the pipeline works with no external calls (from your laptop):

```bash
npm run demo:offline -- --all
```

On the deployed site, set `WAYFINDER_OFFLINE=1` on a **Preview** deployment (not Production), open `/`, click
**Load demo case** (epithelioid sarcoma), confirm the fields, and check `/cases/<id>/swarm` reaches
`/cases/<id>/shortlist` in under 3 minutes with evidence links. Walk-through steps: docs/DEMO.md.

**One allowlisted send (test inbox we own).**

```bash
# 1. Create fictional coordinator inboxes (needs AGENTMAIL_API_KEY in .env.local)
npx tsx scripts/seed-demo.ts --live
# It prints an OUTBOUND_ALLOWLIST=... line. Add those addresses (plus any test phone we own) to
# OUTBOUND_ALLOWLIST in Vercel, then redeploy.
```

1. Open `/`, load the demo case, run research, select a demo coordinator on the shortlist.
2. Consent -> tick fields -> Outbox -> **Approve** the email. It must say sent; the address is on the allowlist.
3. Confirm the message arrives in the AgentMail console (Inboxes -> the coordinator inbox).
4. **Negative test:** with a throwaway case, try to approve a draft to an address NOT on `OUTBOUND_ALLOWLIST`
   (for example `nobody@example.com`). It must be refused with `not_allowlisted` and nothing sent. Do not use a real
   hospital address for this test; `example.com` is the right choice.

**Inngest run appears.** After research starts or an email is approved: Inngest -> **Runs**. Expect a
`research-case` run, then `contact-connection` after approval, both Completed or Running (waiting for reply).

**Webhook reply lands.** Run the fictional coordinators (they only reply to `DEMO_REPLY_ALLOWLIST`, our case inbox):

```bash
npx tsx scripts/demo-coordinators.ts --live
```

Within 20-40 s: AgentMail -> Webhooks -> your endpoint shows a 200 delivery, and `/cases/<id>/tracker` shows a new
task ("please send slides" etc.). A `contact-connection` run in Inngest resumes on the reply.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Production build fails: `Result: N required variable(s) missing` (check-env step, before `next build`) | `check-env --strict` found required vars unset for Production. This is intentional. | The log lists each `✗ missing  NAME`. Add them in Vercel -> Settings -> Environment Variables (Production), redeploy. Reproduce locally with `npx tsx scripts/check-env.ts --mode prod --strict`. For the hackathon deployment set `WAYFINDER_MODE=demo` (fewer requirements) rather than weakening checks. At runtime the same failure reads `Missing required environment variables for <mode>: ...`. |
| Build fails only on a PR/preview | Preview builds should not be strict; check the build command in the Vercel UI wasn't overridden. | Clear the UI override so `vercel.ts` supplies it. |
| `/api/health` returns 503, `db` is `down` | Bad `DATABASE_URL`, Neon project suspended/cold (health has a 1.5 s ping timeout; retry once), SSL params wrong, or migrations not applied. | Test with `psql "$DATABASE_URL" -c 'select 1'`; ensure `?sslmode=require`; wake the Neon branch; run `npm run db:migrate`. |
| `/api/health` 503, `db` is `not_configured` or `env.missing` has `DATABASE_URL` | `DATABASE_URL` not set for this environment. | Section 4, redeploy. |
| `/api/health` 503, `env.missing` has `MODEL_ACCESS` | Neither `ANTHROPIC_API_KEY` nor both `NEON_AI_GATEWAY_*` set. | Set one (the gateway needs both vars). |
| `/api/health` 503, `inngest` is `not` | `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` missing. | Section 6. |
| Inngest sync fails or calls return 401 | `INNGEST_SIGNING_KEY` wrong or from a different Inngest environment; or Vercel Deployment Protection blocks `/api/inngest`. | Re-copy the Production signing key, redeploy, re-sync. Disable protection for the production domain or add a bypass. |
| Inngest shows 0 functions | App not synced, or synced to a wrong URL. | Re-sync `https://<domain>/api/inngest` (no trailing path). |
| Research run stops after ~300 s | Vercel function time limit (`maxDuration = 300`); research deadline is 180 s. | Check the Inngest run log for the failing step. |
| AgentMail webhook returns 401 (`invalid_signature`) | `AGENTMAIL_WEBHOOK_SECRET` doesn't match the endpoint's secret, was pasted with whitespace, or the deployment wasn't redeployed after setting it. | Re-copy `whsec_...` from the endpoint, redeploy, resend from AgentMail's webhook log. |
| AgentMail webhook returns 404 (`unknown_thread`) | The reply is on a thread Wayfinder didn't create. | Expected for unrelated mail; only replies to threads we sent are accepted. |
| AgentCall webhook returns 401 | `AGENTCALL_WEBHOOK_SECRET` mismatch; signature is HMAC-SHA256 of the raw body, `X-AgentCall-Signature: sha256=<hex>`. | Re-copy the secret, redeploy. |
| Send refused `not_allowlisted` | Address/number not in `OUTBOUND_ALLOWLIST` (correct behaviour for non-test targets). | If it is one of our test inboxes, add it exactly (case-insensitive email or E.164) and redeploy. Do **not** set `OUTBOUND_ALLOW_REAL`. |
| Build error about `@x402/fetch` | The `agentmail` SDK dynamically imports an optional peer that isn't installed. | `next.config.ts` already sets `serverExternalPackages: ["agentmail"]`. If it reappears, check that line wasn't removed; do not install `@x402/fetch`. |
| `/demo` returns 404 | `WAYFINDER_DEMO` isn't exactly `1`. | Intentional off-switch; set it only on demo deployments. |
| `CREATE EXTENSION vector` fails | pgvector not enabled. | Run `CREATE EXTENSION vector;` in the Neon SQL editor. |

Logs: Vercel -> Project -> **Logs** (filter by `/api/webhooks` or `/api/inngest`), or `vercel logs <deployment-url>`.

## 10. Rollback

1. Vercel -> Project -> **Deployments**.
2. Find the last known-good Production deployment (green, "Ready").
3. **... -> Instant Rollback** (or **Promote to Production**). No rebuild occurs, so the production build check
   isn't re-run.
4. CLI equivalent:

```bash
vercel rollback                    # roll back to the previous production deployment
vercel rollback <deployment-url>   # roll back to a specific one
```

5. Re-sync Inngest if function definitions changed between the two deployments (section 6 step 5), and check
   `curl -s https://<domain>/api/health | jq`.
6. Database migrations are **not** rolled back by a Vercel rollback. Migrations in this repo only add; if a
   rollback needs an older schema, fix forward with a new migration rather than editing applied ones.
7. Environment variables are not versioned per deployment on rollback; a rollback uses the vars that were set when
   that deployment was built. Changing a var requires a redeploy to apply.
