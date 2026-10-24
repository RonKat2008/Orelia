# Wayfinder demo

> *Expert finders tell you who the expert is; Wayfinder gets you seen.*

Everything in this demo is fictional. The patient report is synthetic (`fixtures/reports`), and the four
intake coordinators are AgentMail test inboxes we create and own (`fixtures/demo/coordinators.json`). Nothing is
sent to a real hospital, doctor, organization or phone number (HARD RULE 4): OutboundGate only lets mail through to
addresses on `OUTBOUND_ALLOWLIST`, and the scripted coordinators reply only to our own case inbox.

> **Draft step list.** `docs/PLAN.md` refers to a six-step demo script that is not written down yet. The steps below
> follow milestone 4 in the plan; swap in the final wording when the script is agreed.

## Setup (once)

```bash
npm install
cp .env.example .env.local      # then fill in keys; leave AGENTMAIL_API_KEY empty for a dry run
npm run db:migrate
```

Seed the fictional coordinator inboxes and the demo case:

```bash
npx tsx scripts/seed-demo.ts            # dry run: no network, no database writes
npx tsx scripts/seed-demo.ts --live     # real AgentMail test inboxes (needs AGENTMAIL_API_KEY); also inserts
                                        # the demo case when DATABASE_URL is set
```

The script prints an `OUTBOUND_ALLOWLIST=...` line. Add it to `.env.local` yourself, together with our own case
inbox, and set the coordinators' reply allowlist to that case inbox:

```bash
OUTBOUND_ALLOWLIST=<the four coordinator addresses printed by seed-demo>
DEMO_REPLY_ALLOWLIST=<the Wayfinder case inbox address>
WAYFINDER_SIM_TIME_SCALE=1440           # one simulated business day per real minute
```

Start the app and the fictional coordinators in two terminals:

```bash
npm run dev
```

```bash
npx tsx scripts/demo-coordinators.ts            # dry run
npx tsx scripts/demo-coordinators.ts --live     # real AgentMail test inboxes
```

## The demo

| # | Show | What happens |
|---|---|---|
| 1 | **Intake.** On `/`, click "Load demo case" (epithelioid sarcoma) and confirm the extracted fields. | Opus extracts the case from a synthetic report; the patient checks and edits it. |
| 2 | **Swarm.** `/cases/<id>/swarm` | Nine research agents run in parallel and stream live. Network and Logistics report "not implemented". |
| 3 | **Shortlist.** `/cases/<id>/shortlist` | Specialists and centers, trials, advocacy and aid, ranked with reasons. Click an evidence link to show the real source page. Select up to 5 resources (pick the four demo coordinators). |
| 4 | **Consent and approval.** `/cases/<id>/consent`, then `/cases/<id>/outbox` | Tick the fields to share for each contact, read each drafted email (it carries the AI-assistance disclosure) and approve it. Each approved draft passes OutboundGate and goes to a coordinator inbox. |
| 5 | **Replies become tasks.** `/cases/<id>/tracker` | The coordinators answer after 20–40 seconds: "please send slides", "needs a referral" and "call to schedule". The InboxAgent turns each into a task the patient approves. |
| 6 | **Follow-up.** `/cases/<id>/tracker` | The Patient Navigator never replies. With `WAYFINDER_SIM_TIME_SCALE=1440`, business day 3 arrives in about a minute and a follow-up **draft** appears for approval; Wayfinder never sends it on its own. |

Optional: an AgentCall call goes only to a phone number the team owns and opens with the spoken AI disclosure.

## What the coordinators do

| Coordinator (fictional) | Scenario | Reply after |
|---|---|---|
| Intake Desk — Demo Sarcoma Center | please send slides | 20 s |
| New Patient Line — Demo Connective Tissue Clinic | needs referral | 30 s |
| Referral Coordinator — Demo Rare Immunology Program | call to schedule | 40 s |
| Patient Navigator — Demo Advocacy Foundation | silent (triggers the day-3 follow-up) | never |

Delays are divided by `WAYFINDER_SIM_TIME_SCALE`. Each coordinator replies once per thread, and only to senders on
`DEMO_REPLY_ALLOWLIST` (or, if that is unset, `OUTBOUND_ALLOWLIST` minus the coordinators themselves). With neither
set, the coordinators reply to nobody.

## Dry-run mode

Without `AGENTMAIL_API_KEY` (or with `--dry-run`), every script uses a local mailbox file instead of AgentMail.
Addresses end in `@dry-run.agentmail.invalid`, which can never route. State lives in
`$TMPDIR/wayfinder-demo/` (override with `WAYFINDER_DEMO_STATE=/path/state.json`). `demo-coordinators.ts --once`
runs a single pass, which is handy for rehearsing.

## Reset

```bash
npx tsx scripts/demo-reset.ts           # dry run: clears the local mailbox and state
npx tsx scripts/demo-reset.ts --live    # also deletes the AgentMail inboxes recorded in state (never any others)
```

Then remove the demo addresses from `OUTBOUND_ALLOWLIST` in `.env.local`.
