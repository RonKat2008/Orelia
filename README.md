# Orelia

Orelia helps an adult with a rare disease get seen by the right people. It finds specialists and centers, recruiting trials, advocacy organizations, and financial or travel aid, then helps the patient contact the ones they pick. It does not give medical advice.

## Quickstart

Requires Node 22 or newer.

```bash
npm ci
cp .env.example .env.local
npm test
npm run demo:offline -- --all   # runs the full flow from recorded fixtures, no keys needed
npm run dev
```

Set `WAYFINDER_OFFLINE=1` in `.env.local` to replay recorded fixtures instead of calling live APIs. Live runs need the keys in `.env.local`, and `DATABASE_URL` for the database (`npm run db:migrate`). `npm run db:generate` writes migration SQL without a database.

See [docs/DEMO.md](docs/DEMO.md) for the demo walkthrough and [docs/PLAN.md](docs/PLAN.md) for the build plan and hard rules.

## Architecture

```
Intake → extractor (Opus) → patient confirms the Case
  → research swarm (Inngest case/research.requested; one agent_runs row per agent, streamed over SSE)
      literature, trials, identity, centers, advocacy, aid, contact finder, network, logistics
  → verifier (deterministic: drops claims without evidence, merges duplicates)
  → ranker (lib/ranking/rank.ts, weights in config/ranking.ts) → shortlist
  → patient selects up to 5 contacts and picks the fields each may see
  → connection workflow per contact (Inngest): draft → approval → OutboundGate → AgentMail / AgentCall
      → follow-ups at business days 3 and 7, stalled at business day 10
  → inbox classifier (Opus) turns replies and call transcripts into tasks for the patient to approve
```

- `lib/agents/`: research agents, orchestrator, `runAgent()` (`@anthropic-ai/sdk` Messages tool use).
- `lib/sources/`: typed API wrappers. Agents never fetch on their own, and `source_url` comes from the wrapper.
- `lib/safety/`: `checkOutbound()` is the only path out of the system.
- `lib/channels/`: AgentMail and AgentCall adapters, plus mocks. Webhooks are signature-checked in `app/api/webhooks/`.
- `lib/workflows/`: Inngest functions for research and the connection state machine.
- `app/`: intake, live swarm, shortlist, consent, outbox and tracker pages.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate Drizzle migration SQL |
| `npm run db:migrate` | Apply migrations (needs `DATABASE_URL`) |
| `npm run demo:offline` | Run the offline demo (`--all` or `--case <slug>`, `--top <n>`) |

## Secrets

Secrets stay in `.env.local`. `.env.example` lists every variable and is safe to commit.
