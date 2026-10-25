# Live demo: presenter's script

The demo patient is synthetic (vascular EDS fixture). The four resources are fictional ("(fictional)" in their
names, `.example` emails, 555-01xx phones), so even with routing off they cannot reach anyone. Demo mode
(`WAYFINDER_DEMO_COORDINATORS=1` plus an allowlisted coordinator inbox in `DEMO_COORDINATOR_INBOXES`) routes each
channel to our own test destinations:

| Resource | Plan | Where it really goes | What you will see |
|---|---|---|---|
| Demo Connective Tissue Center | email | demo coordinator inbox (AgentMail) | reply "please send the patient's most recent medical records" -> **Send records** card |
| Demo Vascular Genetics Clinic | call | allowlisted test phone (+13462874886) if it is on `OUTBOUND_ALLOWLIST`, else the simulated call sink | ringing -> connected -> transcript lines -> ended + summary; **referral** task |
| Demo Rare Travel Fund | online form | Wayfinder's own demo intake form, filled by the Kernel cloud browser | "Application filled" with a screenshot, then (after approval) "submitted" + confirmation |
| Demo Aortic Care Program | email, then call if no reply | coordinator inbox; the coordinator deliberately stays silent | after **Skip ahead**, a follow-up is drafted for approval |

Nothing is sent without approval. "Approve all" is the patient pressing every approve button in turn through the
normal routes; every send still passes `checkOutbound` (approval, allowlist, ticked fields only, AI disclosure spoken
first on calls, no medical advice, at most 5 active contacts, cadence).

## Before you start (once)
- Production has `WAYFINDER_DEMO_COORDINATORS=1`, `DEMO_COORDINATOR_INBOXES`, `OUTBOUND_ALLOWLIST` (coordinator inbox +
  +13462874886), `AGENTMAIL_*`, `KERNEL_API_KEY`, `CRON_SECRET`, and a voice provider key (AgentCall today; Vapi when
  lane V's provider is configured).
- The cron runs every minute (`/api/cron/follow-ups`, `vercel.ts`), so replies and follow-ups keep moving with no
  tab open. The buttons below only run the same tick early.
- Keep the test phone nearby and unmuted if a real call is configured.

## Tabs to open
1. `https://wayfinder-amber-seven.vercel.app/demo` (the launcher).
2. After "Run full demo": the live console, `/cases/<id>/live?view=judge` (opens automatically).
3. Optional: the tracker `/cases/<id>/tracker?view=judge` and the outbox `/cases/<id>/outbox` in a second tab, to
   show the same events land in the patient's normal screens.

## 3-minute version
1. (0:00) `/demo` -> **Run full demo**. Say: "A synthetic vEDS patient. The plan picked one resource per channel:
   email, call, online form, and email-then-call." The console opens with four contact lanes.
2. (0:30) **Approve all**. Point at the per-item list under the button: plan approved, two emails sent, one call
   placed. Say: "One click, but each item still went through the safety gate."
3. (0:50) The call lane: ringing -> connected; transcript lines stream into the call panel, the AI disclosure is the
   first line. If the provider gives a listen-in link, the call panel shows **Listen in** (judge view only).
4. (1:40) **Approve all** again when it shows "(1)": the Kernel browser has filled the demo form (screenshot in the
   timeline); approval submits it and the confirmation appears.
5. (2:10) **Deliver replies now** (or wait up to a minute for cron): the coordinator's reply arrives, the lane turns
   "Replied", and a **Send records** task appears. **Skip ahead 3 business days**: the silent Aortic program gets a
   drafted follow-up, waiting for approval. Close: "Close the laptop and this keeps going: the server does it."

## 7-minute version
Do the 3-minute script, slower, and add:
- **Plan** tab before approving: show the evidence badge per step and the "call if no reply after 3 business days"
  step for the Aortic program.
- **Consent** tab: only four fields are ticked (diagnosis, subtype, state, goals); the email body contains only those.
- **Outbox** after Approve all: the sent email with the AI disclosure first; the call script.
- **Persistence**: open the console in a private window (different session -> 404, it is owner-only), then explain
  the cron tick: every minute, leased rows (`UPDATE ... FOR UPDATE SKIP LOCKED`), at-most-once sends, a
  failing step never blocks the others. Overlapping ticks are tested (`tests/workflows/cron-tick.test.ts`).
- **Threads**: the reply text is untrusted; it is sanitized and classified, never followed as instructions.
- After **Skip ahead**: approve the follow-up with **Approve all** and show the cadence still applies.

## How replies show up
- Email: the coordinator inbox replies in the same AgentMail thread (`lib/demo-live/responder.ts`, run by the
  cron tick). Only threads Wayfinder started are answered, once per thread. AgentMail's webhook stores the
  reply, the inbox agent classifies it, and the task appears. The console polls/streams every ~1.5 s.
- Calls: provider webhooks write status and transcript turns (Vapi: `call_live` / `call_turns`; AgentCall: the
  `calls` row). The console reads whichever exists. Simulated calls feed a scripted transcript through the same
  ingest.
- Browser: the application row's status (filled, approved, submitted) plus the screenshot.

## From a terminal
```
npx tsx scripts/demo-live.ts --base https://wayfinder-amber-seven.vercel.app --approve --watch 120 --skip-ahead
```
The script holds its own session, so its case is not visible in your browser. Use the button to present.

## Reset
- In the console, **Delete case** (bottom of the page) removes the case and everything under it. Every click on
  "Run full demo" makes a new case, so nothing needs resetting between runs (12 starts per hour per IP).
- The fictional institution/organization rows stay behind after a delete (they are global tables). Harmless;
  remove them with `delete from institutions where name like '%(fictional)'` (and the same for organizations).
- The local rehearsal panel (`WAYFINDER_DEMO=1`, dry-run) still has `scripts/demo-reset.ts`.

## Persistence: what runs with no tab open
- Cron tick every minute: follow-up sweep (pre-approved walk-away sends or drafts for approval, stall at day 10),
  demo coordinator replies, and (lane F) due resource agents.
- Webhooks: AgentMail replies, call status and transcripts, Kernel results.
- The browser only reads. Approval is the one thing a person must do.
- Next step for long waits: Vercel Workflow (or Inngest, whose code exists but is not configured in production) for
  durable sleeps and per-contact timers instead of a minute sweep.
