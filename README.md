# Wayfinder

Wayfinder helps an adult with a rare disease get seen by the right people. It finds specialists and centers, recruiting trials, advocacy organizations, and financial or travel aid. It does not give medical advice.

## Setup

```bash
npm i
cp .env.example .env.local
npm run db:migrate
npm run dev
```

`db:migrate` needs a Postgres `DATABASE_URL` in `.env.local`. Generate SQL without a database with `npm run db:generate`.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run demo:offline
```

`demo:offline` runs `scripts/demo-offline.ts` once that script exists. Set `WAYFINDER_OFFLINE=1` to replay recorded fixtures instead of live APIs.

Secrets stay in `.env.local`. `.env.example` lists every variable and is safe to commit.
