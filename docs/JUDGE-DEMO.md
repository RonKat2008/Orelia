# Judge demo: the test case and how to walk the whole product

A rehearsed run for showing judges the complete loop on one laptop: account sign-in, a medical document library,
a live expert search, consent, a contact plan, and an AI phone call that rings the team phone. Everything is
fictional (HARD RULES 3 and 4 in `docs/PLAN.md`): the patient is synthetic, emails go only to the team's own test
inbox, and the only phone that can ever ring is the allowlisted team phone.

## The test case

| | |
|---|---|
| Patient | Marcus T. Delacroix, 41, Tucson AZ (synthetic) |
| Condition | Epithelioid sarcoma, proximal-type, after excision with a positive margin |
| Goals | Second opinion and a clinical trial; can travel up to 600 miles; Bluepeak Health PPO |
| Account | Name Marcus Delacroix. Email and password are the `DEMO_ACCOUNT_EMAIL` / `DEMO_ACCOUNT_PASSWORD` lines in `.env.local` |
| Documents | `fixtures/demo/judge-case/`: pathology report, MRI, oncology consult note, insurance and referral letter. Already in the account's library |
| Prepared case | Already researched, 5 contacts chosen, consent saved, plan ready. Open it from the account menu → Your cases, or from http://localhost:3000/cases/328f16a7-1042-40ab-a19c-93b6b8f9abe3 |
| Team phone | On `OUTBOUND_ALLOWLIST` in `.env.local` in E.164 form. Demo coordinator mode routes every call there; the three call drafts in the prepared case already point at it |
| Consent on file | Everything shared except the insurance member ID |

Two ways to run it: the **prepared case** (skip straight to the call, 3 minutes) or the **full run** (a fresh case
from the pasted report, 10 minutes, costs about a dollar in model calls).

## Before the judges arrive

Two terminals in the project folder.

Terminal 1, the app. The `NODE_OPTIONS` part matters on a Mac without IPv6: Node's default 250 ms per-address
connect window makes about one in ten connections to Neon and the research sources fail, which shows up as
"fetch failed" and stuck searches.

```bash
NODE_OPTIONS="--dns-result-order=ipv4first --network-family-autoselection-attempt-timeout=3000" npm run dev
```

Terminal 2, the workflow engine. Without it every send is refused.

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest --no-discovery
```

Check http://localhost:3000/api/health says `"db": "up"` and `"scheduler": "inngest"`. Put the team phone where
everyone can hear it. Sign in as the demo account (account icon, top right → Sign in).

**AgentCall account, the day before.** A new AgentCall account is a 72-hour free trial that allows inbound AI calls
only: outbound calls need the Pro plan ($19.99/month plus about $0.40 per AI minute), and a new account is also
"restricted" until the destination number is verified. With the trial plan every approved call is refused by the
provider and the outbox shows "Provider said: agentcall: HTTP 403 plan_limit_…". Before the demo:

1. Upgrade at https://agentcall.co/billing (the account owner does this; it needs a card).
2. Add the team phone as a verified destination in the AgentCall dashboard (or `POST /v1/verified-destinations/`
   then `/confirm` with the code it texts), so the account's trust state is no longer restricted.
3. Check `GET https://api.agentcall.co/v1/account/` shows `maxCallMinutesPerMonth` above 0, and
   `GET /v1/verified-destinations/` lists the team number.

## The walkthrough, page by page

The header has a **Patient / Judge** toggle. Patient view shows one plain next step. Judge view shows every agent,
source, score and safety check. Switch to Judge whenever you want to show the machinery.

### 1. Landing, How it works, Trust (1 minute)

- `/` The pitch: expert finders tell you who the expert is; Orelia gets you seen. Note the banner: never medical
  advice.
- `/how-it-works` The four steps and the three channels (call, email, online form).
- `/trust` What it will never do. These are code, not settings: no medical advice, every claim sourced, nothing sent
  without approval, at most five contacts, AI disclosure on every message and call.

### 2. Account and documents (1 minute)

- Account menu → **Documents** (`/account/documents`). Four synthetic records, each extracted and embedded. Open one
  to show the extracted text. Optional live moment: delete the MRI and drag `02-mri-report.txt` back in; it is read
  and indexed in seconds.
- Account menu → **Profile** stores who you are so you never retype it. **Download my data** exports everything as
  JSON. **Delete account** removes all of it.
- Say: the library is private, and agents only ever see what the patient later ticks for a specific contact.

### 3. Start a case (full run only, 1 minute)

- **Start your case** (`/start`). Answer-questions path or **Upload a report instead**. Paste
  `fixtures/demo/judge-case/01-pathology-report.txt`, press **Read my report**. The model extracts condition,
  city, travel limit, goals and insurer. Each is confirmable. **Start the search.**

### 4. The search (full run: 3 minutes; prepared case: show the Judge pages)

- Patient view counts sources done. Switch to **Judge** → the case menu (top left) opens the case pages:
  - **Swarm** (`/cases/<id>/swarm`): nine agents side by side with live status: literature (PubMed), trials
    (ClinicalTrials.gov), identity (NPI registry), centers (NCI list), advocacy, aid, contact finder, network,
    logistics. Then verifier, ranker and judge.
  - **Research** (`/cases/<id>/research`): what each agent returned, tokens and cost per agent.
  - **Shortlist** (`/cases/<id>/shortlist`): two-pane console. Every row has a score breakdown and evidence links.
    Click a link: it opens the real public source. Tiers are best / good / backup / exclude with cited reasons.
  - **Experts** (`/cases/<id>/experts`): specialists with publications, trials led and whether they see patients.
  - **Condition brief**: the plain-language brief built only from collected sources.

### 5. Choose, consent, plan (prepared case: already done; show the pages)

- Patient view: **Pick who we contact first**. Up to five. Rows say Phone, Email or Online form. The prepared case
  has two trials and a sarcoma center by **Phone**, two aid programs by **Email**.
- **Consent** (`/cases/<id>/consent`): one question per field. The prepared case shares everything except the
  insurance member ID, so you can show an unticked field never appearing in any draft.
- **Plan** (`/cases/<id>/plan`): how each contact will be reached, in what order, with the evidence for each step.
  Steps can be toggled. **OK this plan** writes the drafts.

### 6. The outbox and the call (2 minutes)

- **Outbox** (`/cases/<id>/outbox`, or the patient "Read the draft" card). Open it once and give it up to a minute:
  it writes or refreshes one draft per contact on load and shows "Writing drafts: N of 5 ready" meanwhile. Do not
  reload while it counts. The prepared case has three call scripts (UCLA sarcoma program and the two trials) and
  two emails (the Sarcoma Alliance funds). Pick a **Phone** contact. The script
  starts with the spoken AI disclosure and contains only the ticked fields. The safety checklist under it shows
  the gate: approved by you, allowlist, ticked fields only, disclosure present, no medical advice, under the cap.
- Press **Approve this call** and confirm. The team phone rings within seconds. The first sentence is the
  disclosure. Answer as an intake coordinator: "we need a referral and the most recent records."
- Then approve an **Email** draft: it lands in the team's AgentMail test inbox, labelled "Demo coordinator".

### 7. Replies, tasks, follow-ups (1 minute, talk-through)

- **Tracker** (`/cases/<id>/tracker`): every contact's state (drafted, sent, replied, task open, stalled).
- **Threads** (`/cases/<id>/threads`): the email conversation per contact.
- Replies arrive by webhook; the inbox agent turns "send records" into a task the patient approves. Follow-ups on
  business day 3 and 7 are pre-approved drafts shown in the outbox; nothing ever goes out on its own.
- Scripted reply for the email contact, from a second terminal:

```bash
npx tsx scripts/demo-coordinators.ts --live --once
```

### 8. The rest of the product (optional, 1 minute)

- **Appointments** and **Calendar** (`/cases/<id>/appointments`, `/calendar`): captured appointments, ICS feed,
  Google Calendar sync when configured.
- **History** (`/cases/<id>/history`): the medical-history extractor reconciles multiple records and flags
  conflicts. **Share** creates an expiring link for a doctor.
- **Coordinate** and **Review** (`/cases/<id>/coordinate`, `/cases/<id>/review`): a packet for a consulting doctor
  and a signed review link (`/review/<token>`) that returns a verdict.
- **Documents** (`/cases/<id>/documents`): what this case's agents retrieved, with sources.

## If something goes wrong

- **"The safety check refused this draft"**: the outbound gate said no and nothing was sent. The reasons are listed
  under the draft; usually a field was unticked after drafting. Re-draft from consent.
- **Search stops at "Putting your list together" or says "A few searches didn't finish"**: a connection dropped.
  Check Terminal 1 was started with the `NODE_OPTIONS` line above. Wait six minutes, then start the search again from
  the case page; the watchdog reclaims the stuck run and a fresh one starts. Three runs per case per hour; after that
  start a new case.
- **Sends refused with "Inngest is not configured"**: Terminal 2 is not running.
- **No "Phone" rows in the shortlist**: expand "Show more" and pick a clinical trial; trial central contacts are
  phone numbers. In demo mode the call still rings the team phone, never the trial.
- **"Provider said: agentcall: HTTP 403 plan_limit…"**: the AgentCall account is still on the trial plan or the
  destination is unverified. See "AgentCall account, the day before" above. Nothing was dialed; approve again after.
- **Transcript never arrives**: expected on a laptop, since AgentCall's webhook cannot reach localhost. The call
  itself still happens. A public tunnel (or the Vercel deployment) is needed for the reply-to-task step.

## Costs and resets

A live search costs roughly $0.50 to $1.00 in model calls, most of it the curator. To reset, delete the case from
the case page ("Delete case"); the account and documents stay. The allowlist and demo flags live only in `.env.local`.
