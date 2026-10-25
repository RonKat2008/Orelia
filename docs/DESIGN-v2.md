# Orelia design v2: "Clear Day, quieter"

Status: spec, not yet implemented. Extends `docs/DESIGN.md` (Clear Day) and replaces it wherever the two disagree.
Palette, fonts and the hero particle field are kept. What changes is **how much** we put on each screen.

Inputs: a primary-source research pass (NHS service manual, GOV.UK Design System, Nielsen Norman Group, WCAG 2.2,
CDC, MDN/web.dev, Stripe, Linear), and a live audit of https://wayfinder-amber-seven.vercel.app at 1440 px and
375 px in real Chrome, on 2026-10-24. The audit used a synthetic case (EDS, suspected, Boston, "Test Patient"),
which was deleted afterwards.

Audience:

- **Patients:** adults with a rare disease, and their carers. They are often tired, anxious or low-vision. In
  **patient view** they want the shortest path to "someone will see me".
- **Hackathon judges:** they use **judge view** to watch the agents work. It can be denser than patient view, but
  it must stay calm and easy to scan.

---

## 0. TL;DR

1. **The patient view is one column with one question and one button.** Every patient screen answers three
   things: where am I, what do you need from me, what happens next. Everything else goes behind "Details".
2. **One navigation system per screen.** The case header has the case name and a 4-step progress line. The left
   7-step rail and the 7-pill outreach tab row are merged into one judge-only **stage bar**.
3. **Budgets, not taste.** Each view may have at most:
   - 1 primary button;
   - 3 type sizes;
   - 2 badges per card;
   - 1 accent hue per card, beyond teal and the status colours.
4. **Judge view is a calm two-pane console.** The work list is on the left and the detail on the right. The same
   tokens apply, with denser rows instead of cards.
5. **The hero keeps its layout, headline and particle field.** We remove the body paragraph, the 3 bullets, the
   judge text link and the sample-case card's chips. The sample-case card simplifies to a three-line status.
6. **Copy at grade 6 to 8.** Patients never see "agent", "swarm", "curator", "verifier", "allowlist", scores or
   formulas. Judges do.

---

## 1. Researched rules (sources)

All URLs were fetched during research unless marked *(unverified)*. Orelia decisions in later sections cite
these rules as **R1 to R37**.

### Structure and flow

| # | Rule | Source |
|---|---|---|
| R1 | Ask **one question per page** by default. Group questions only when research supports it. | https://design-system.service.gov.uk/patterns/question-pages/ |
| R2 | The question is the page heading (as `<label>`/`<legend>`). Every page has a Back link and a "Continue" button. | same |
| R3 | Ask for each piece of information **once** per journey, and prefill it after that (WCAG 3.3.7, Level A). | https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html |
| R4 | End a multi-step entry with a **check-answers** page that has a "Change" link per answer. Show skipped optional answers as "Not provided". | https://design-system.service.gov.uk/patterns/check-answers/ |
| R5 | For long jobs, use a **task list** with as few statuses as possible ("the more you add, the harder it is for users to remember them"). | https://design-system.service.gov.uk/patterns/complete-multiple-tasks/ |
| R6 | Limit progressive disclosure to **two levels**. Show frequent items first and label the path to the rest. | https://www.nngroup.com/articles/progressive-disclosure/ |
| R7 | Put the **main message first**, with the key points in the first two paragraphs. Start headings with the meaningful words (F-pattern). | https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/ , https://www.cdc.gov/health-literacy/php/develop-materials/plain-language.html |

### Layout and density

| # | Rule | Source |
|---|---|---|
| R8 | Put main content in a **two-thirds column** inside a container of at most 960 px (NHS) or 1020 px (GOV.UK). Keep lines to 70 to 80 characters. | https://service-manual.nhs.uk/design-system/styles/layout , https://design-system.service.gov.uk/styles/layout/ |
| R9 | Use at most **three type sizes** per screen and at most two large elements. Use about three contrast treatments. | https://www.nngroup.com/articles/visual-hierarchy-ux-definition/ |
| R10 | Group by **proximity**: tight gaps inside a group, larger gaps between groups. Add a border or background only when space is not enough. | same, and https://www.nngroup.com/articles/layer-cake-pattern-scanning/ |
| R11 | Use **cards only for varied, browsable items**. Use **lists for homogeneous or comparable items**. Make the whole card the target. | https://www.nngroup.com/articles/cards-component/ |
| R12 | A dashboard is **one screen** of critical information. Encode quantity by length or position, never by colour alone. | https://www.nngroup.com/articles/dashboards-preattentive/ |
| R13 | Add a badge only when the state is **dynamic** and would be missed. "Indicators can add clutter." | https://www.nngroup.com/articles/indicators-validations-notifications/ |
| R14 | Use **one primary button per page**, left-aligned with the content. Use secondaries sparingly. A warning button only for serious, hard-to-undo actions, with a confirmation step. | https://service-manual.nhs.uk/design-system/components/buttons , https://design-system.service.gov.uk/components/button/ |

### Typography and content

| # | Rule | Source |
|---|---|---|
| R15 | Write for an NHS reading age of 9 to 11. Sentences have at most 20 words and paragraphs at most 3 sentences. | https://service-manual.nhs.uk/content/how-we-write |
| R16 | Aim for **grade 6 to 8** in patient text, and nearer grade 6 when unsure. | Secondary: https://pmc.ncbi.nlm.nih.gov/articles/PMC6334864 *(unverified)* |
| R17 | Use **everyday words**. Put the plain term first and the medical term in brackets. | https://service-manual.nhs.uk/content/a-to-z-of-nhs-health-writing |
| R18 | Write in the **active voice** and say "you". Name who does what. Avoid metaphors. | same, and https://www.cdc.gov/ccindex/index.html |
| R19 | Write numbers as **numerals**, say what each number means, and give specifics ("in 3 days", not "soon"). | https://www.cdc.gov/ccindex/index.html |
| R20 | Body text is **19 px / 25 px** (GOV.UK). Use 16 px sparingly. Left-align, never justify. Scale: 48/36/24/19/16. | https://design-system.service.gov.uk/styles/type-scale/ |

### Colour and status

| # | Rule | Source |
|---|---|---|
| R21 | **Never use colour alone.** Pair it with an icon, a shape or a word. | https://service-manual.nhs.uk/design-system/components/care-cards |
| R22 | Use **red only for errors** and urgent action. Use about 2 primary and 2 secondary colours. | https://design-system.service.gov.uk/patterns/complete-multiple-tasks/ |
| R23 | Show **completed items quietly** (plain text, no coloured tag), so items that need action stand out. | same |
| R24 | Use urgent callouts (care cards) once per type, and never on question pages. | https://service-manual.nhs.uk/design-system/components/care-cards |
| R25 | Use inset text very sparingly, and never for critical information. | https://design-system.service.gov.uk/components/inset-text/ |
| R26 | Use perceptually uniform palettes and restrained accents. Colours 5 steps apart pass for small text; Linear drives its UI from base, accent and contrast. | https://stripe.com/blog/accessible-color-systems , https://linear.app/now/how-we-redesigned-the-linear-ui |

### Interaction and forms

| # | Rule | Source |
|---|---|---|
| R27 | **Validate on Continue**, not on blur or keypress, and keep what the user typed. | https://design-system.service.gov.uk/patterns/validation/ |
| R28 | On error, show an **error summary** at the top ("There is a problem") and move focus to it. Repeat the same message by the field, as the problem plus the fix. No "please", "sorry", "invalid" or "oops". | https://service-manual.nhs.uk/design-system/components/error-summary , https://design-system.service.gov.uk/components/error-message/ |
| R29 | Mark fields "(optional)" instead of using asterisks, and give at most one short hint. Use **Details only for information some users need**, never for information most users need. | https://service-manual.nhs.uk/design-system/components/details |

### Accessibility

| # | Rule | Source |
|---|---|---|
| R30 | Targets are at least **24 × 24 CSS px** (WCAG 2.5.8 AA). We use 44 px for primary controls (our own inference). | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| R31 | Focus must not be hidden by sticky bars (2.4.11 AA): use `scroll-padding`. The focus ring is at least 2 px with 3:1 change (2.4.13). | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html , https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html |
| R32 | Text contrast is 4.5:1 (3:1 for large text). UI boundaries and state indicators are 3:1. | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html , https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html |
| R33 | Allow paste and autofill, and offer an email link instead of codes (3.3.8 AA). | https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html |

### Motion

| # | Rule | Source |
|---|---|---|
| R34 | Animate only for **feedback, state change and orientation**. Competing animations cancel each other. Never use motion to create urgency. | https://www.nngroup.com/articles/animation-purpose-ux/ |
| R35 | Durations: **100 ms** for feedback, **200 to 300 ms** for state changes, **at most 400 ms** for large moves, never over 500 ms. Entering takes about 300 ms and exiting 200 to 250 ms. | https://www.nngroup.com/articles/animation-duration/ |
| R36 | Honour `prefers-reduced-motion`: replace scale and pan with a short fade or nothing. | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion , https://web.dev/articles/prefers-reduced-motion |
| R37 | Auto-motion that lasts **over 5 s** needs pause, stop or hide (WCAG 2.2.2). | https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html |

Gaps: we could not read the Apple HIG colour and motion pages, Material 3 motion tokens, or One Medical and Oscar
design writing (they render with JavaScript, or are not published). Patterns we took from those products, such as a
single summary at the top, a "next step" card and keyboard-first density in power views, come from the products
themselves and are not cited as rules.

---

## 2. What the audit found

Full findings with per-page metrics, axe output and severity:
`/private/tmp/claude-501/-Users-ronitkatikaneni/abf3d0ff-bb8e-4c7c-bab2-98f67d5b237e/scratchpad/qa-ui-audit/FINDINGS.md`.
Screenshots are in the same folder. They live outside the repo, so they are not committed.

The top problems, in ranked order:

1. **Patient view only simplifies the case home.** All 13 case sub-pages are identical in both views. Patients
   see scoring bars, "Nine researchers, one map", "Tune the order" and reviewer forms.
2. **Three navigation systems on every case page.**
   - A left 7-step rail ("Step 4 of 7").
   - A 7-pill outreach tab row (Consent 1 … Appointments 7).
   - A 4-link tools cluster.
   - The global nav on top of these.
   On a phone this pushes content about 700 px down.
3. **The two step counts contradict each other.** The rail says "Step 4 of 7: Consent" while the pills say
   "2 Plan".
4. **The shortlist is a wall.** It has 16 cards and 2,231 words, and runs 11.5k px on desktop and 20k px on a phone.
   Each card carries:
   - a type tag and a tier pill;
   - 1 to 3 Verified chips and a source count;
   - a score breakdown with weights;
   - a "contact door" panel and a "Verify by phone" button;
   - a select checkbox.
   It also has 38 axe label-content-name-mismatch violations.
5. **Competing CTAs.** Plan, Tracker and Threads have 10 primary-weight controls each, Consent has 9 and Review has
   19. The black active pill has the same weight as the primary button.
6. **Jargon reaches patients:** agent swarm, curator, verifier, final judge, allowlist, "Demo: delivered to
   Orelia test inbox" (in coral-red), "Ties break by candidate id".
7. **Too many sizes and colours.** The landing page uses 12 font sizes, 14 text colours and 28 badges. Case pages
   use 8 to 10 sizes.
8. **Repetition.**
   - The safety line appears 3 times per page (banner, body, footer).
   - "Nothing is sent without your approval" appears 4 or more times on the landing page and on every shortlist
     card.
   - The landing page re-states /how-it-works and /trust almost verbatim.
9. **Dead ends and contradictions.**
   - The outbox says "Nothing is waiting for your approval" above a red "No draft" card.
   - The judge home shows "Contacts chosen 0" while the shortlist shows "2 of 5 chosen".
   - /about says "Seven steps" while /how-it-works says "Five steps".
10. **Raw keys leak.** The Documents page shows `HomeCity`, `DiseaseName` and `HomeState` as titles, duplicated.
11. **Low-value empties.**
    - 7 of the 9 consent toggles read "Not on file".
    - Swarm shows 3 "Not available yet" tiles and a stuck-looking "queued" row.
    - Plan offers reorder arrows for a single item.
12. **A11y debt.**
    - `aria-progressbar-name` on every case page.
    - `heading-order` on every mobile case page.
    - `landmark-unique` and `aria-valid-attr-value` on the shortlist.
    - 1 `color-contrast` on the landing page.
    - An unlabeled field on History.
    - There was **no horizontal overflow at 375 px** anywhere; keep it that way.
13. **The header wraps at 1440 px.** "Start a / case", "Trust & / safety" and "Sign / in" break onto two lines
    because the case nav has 5 items, plus the view toggle and the theme toggle.

What already works, and should be kept and extended:

- The patient case home: one question, a 4-segment progress line ("Tell us / We search / You choose / We reach
  out") and one button.
- The patient intake at /start: one question and one Next.
- Calm auth cards.
- The token palette and contrast table.

---

## 3. Principles

Each principle maps to the rules in section 1.

| # | Principle | What it means here | Rules |
|---|---|---|---|
| P1 | **One thing per screen** | In patient view, each screen asks one question or shows one decision. Multi-part decisions become a sequence with a check-answers step. | R1, R2, R4, R14 |
| P2 | **Answer the three questions first** | The top of every case screen says, in this order: where you are, what we need from you, what happens next. Nothing goes above that except the header. | R7, R12 |
| P3 | **Details are one click away, never two** | Evidence, scores, agent traces and sources sit behind one labelled "Details" disclosure, or in the judge view. Never nest disclosures. Never hide what most users need. | R6, R29 |
| P4 | **Lists for comparing, cards for doing** | Comparable items (shortlist, outbox, tracker, sources) are rows. A card is reserved for the single "do this now" action and for varied tiles on the landing page. | R11, R10 |
| P5 | **Budgets beat judgement** | The per-view budgets for CTAs, sizes, badges and accents are in section 4. A reviewer can count them. | R9, R13, R14, R22 |
| P6 | **Colour means something or it isn't there** | Teal means action. Green, amber and red are status, always with a word. Channel and source hues appear only as a 16 px icon tint or an 8 px dot, never as fills on patient screens. | R21, R22, R23, R26 |
| P7 | **Done things go quiet** | Completed steps and sent messages turn to plain ink-2 text with a check. Only what needs action gets emphasis. | R23 |
| P8 | **Plain words, short sentences** | Grade 6 to 8. At most 20 words per sentence and 3 sentences per block. Say "you" and "we". No agent or ML vocabulary in patient view. | R15 to R19 |
| P9 | **Say it once** | The safety line appears once (the banner), plus a 1-line footer on pages that send. "Nothing is sent without your OK" appears once per screen at most, next to the button it applies to. | R25 |
| P10 | **Big, steady, reachable** | Body text is 18 px or more in patient view, primary targets are 44 px, and focus is never hidden by sticky bars. | R20, R30, R31, R32 |
| P11 | **Motion explains, then stops** | Only state changes animate, at 150 to 300 ms. The hero field is the one ambient animation, and it has a pause control. | R34 to R37 |
| P12 | **Judge view is the same product, zoomed in** | Same tokens and same row components, with a second pane. It is denser, but not louder. | R10, R12 |

---

## 4. Token refinements (`app/styles/theme.css`, lane A)

No new colours and no renamed tokens. These are **usage** rules plus a few additive tokens.

### 4.1 Colour usage

| Role | Allowed tokens | Patient view | Judge view |
|---|---|---|---|
| Action | `teal`, `teal-ink`, `on-teal`, `teal-soft` (selected rows) | 1 filled primary per view; links | same |
| Text | `ink`, `ink-2`, `ink-3` | `ink-3` only for timestamps and captions of 14 px or more | same |
| Surfaces | `paper`, `paper-2`, `card`, `line`, `line-strong` | `paper` page, at most 1 `card` (the action card) | `paper` page, `card` for the detail pane |
| Status | `ok`, `warn`/`warn-ink`, `danger` (+ `-soft`) | Always icon + word. `danger` only for errors and the delete confirmation. | same |
| Channel and source | `ch-*`, `src-*` | Icon tint only (16 px glyph). No soft fills, no coloured pills. | Icon tint plus an 8 px dot. `-soft` fills only in the swarm map legend. |
| Accents | `sage`, `terracotta`, `gold` | Hero field and safety banner only | same |

Changes:

- **Remove the coral "your turn" dot** and the coral `Demo:` pill (`terracotta-soft`). Coral is now hero and
  marketing only. "Your turn" becomes a teal `Badge tone="teal"` with the word.
- **Demo labels** use `Badge tone="neutral"` with an outline and the word "Test inbox". They appear in judge view
  only.
- **Active nav and tab state** stops using a black `bg-ink` fill. Use a 2 px teal underline, or `teal-soft` with
  `teal-ink` text. Ink fills compete with the primary button (finding 5).
- **Delete** is a ghost button with `danger` text. It sits only in a "Manage case" area, never beside the next step.

### 4.2 Type scale (fewer sizes)

Today there are 10 classes, and pages show 8 to 12 distinct sizes. v2 keeps the classes for compatibility, but
**each view may use at most 3 sizes for content** (header chrome excluded). Patient view sizes up the body text.

| Step | Class | Size | Used for |
|---|---|---|---|
| Display | `text-display` | unchanged | **Landing hero h1 only** |
| Title | `text-h1` → **new value** `clamp(2rem, 1.6rem + 1.6vw, 2.75rem)` | 32 to 44 px | One per page: the page question or title |
| Section | `text-h3` | 22 to 28 px | Section headings, action-card titles |
| Body | `text-body` → **patient view** `1.125rem/1.6` (18 px); judge `1rem/1.55` | 18 / 16 px | All reading and controls |
| Small | `text-small` | 14 px | Metadata, captions, row secondary text. Never paragraphs. |

- Retire from case pages: `text-h2`, `text-h4`, `text-lead`, `text-micro` uppercase eyebrows. Marketing pages may
  keep `text-h2` for section titles.
- **No uppercase eyebrows** in the patient view. In judge view, at most one per pane.
- Remove `html { font-size: 17px }` from legacy `globals.css` once lane A migrates, so the reader's browser size
  applies. Re-check all `rem` geometry after this.
- `emph` (italic teal word) appears **only** in the landing h1. Remove it from AppShell titles and from "How we will
  *reach* each resource".
- Add `--text-body-patient: 1.125rem` and a `[data-view="patient"]` rule that maps `text-body` to it.

### 4.3 Spacing scale and rhythm

Keep Tailwind's 4 px base, but use only these steps in new code:

| Token | px | Use |
|---|---|---|
| `1` | 4 | Icon to label |
| `2` | 8 | Inside a row: title to meta |
| `3` | 12 | Between chips/badges, between form hint and field |
| `4` | 16 | Inside cards between lines, row padding (y) |
| `6` | 24 | Card padding, between related groups |
| `stack` | 24 → 48 | Between sections of a page |
| `section` | 64 → 144 | Marketing sections only |

The rhythm rule is **tight inside, loose between** (R10). A group's inner gap must be at most half its outer gap.
Do not put padding and a border on the same group when spacing alone separates it.

### 4.4 Surfaces and cards

| Surface | Spec | When |
|---|---|---|
| Page | `bg-paper` | always |
| **Action card** | `Card variant="raised" padding="lg"`, 2 px top border in `teal`, `rounded-lg` | The one "do this now" block. Max 1 per view. |
| Pane | `bg-card border border-line rounded-lg`, no shadow | Judge detail pane, dialogs |
| Row | No box. 16 px vertical padding, a `border-b border-line` hairline, hover `bg-paper-2`, whole row is the target | Lists: shortlist, outbox, tracker, sources, documents |
| Well | `bg-paper-2 rounded-md` | Quoted letter text, transcripts, code |

- No nested cards. A card never contains another bordered box. Use a well or a row instead.
- Shadows: `shadow-md` only on the action card and on popovers and dialogs. Remove shadows from list items.

### 4.5 Badge and icon budget

- **Patient view: at most 1 badge per row or card**, and only for a dynamic state: "Your turn", "Replied", "Needs
  you", "Couldn't reach". Static facts become plain text ("Email", "Clinic").
- **Judge view: at most 2 badges per row** (tier and verification). Source chips go inside the Details pane, not on
  the row.
- "Verified" becomes a single `ShieldCheck` icon with the word "Checked" in `text-small ok`, once per item. It is no
  longer one chip per source on the row.
- Icons are lucide, 16 px inline and 20 px in buttons, stroke 2. **One icon per control at most.** No decorative
  icons in headings. Channel icons: `Mail`, `Phone`, `FileText` (online form).

### 4.6 CTA rules

- One `Button variant="primary"` per view. In patient view it is `size="lg"` and left-aligned under the content
  (R14). In judge view it sits in the pane header or footer.
- At most 1 secondary button. Everything else is a `link` variant or lives in a "More" menu.
- The header CTA ("Start your case") is hidden on case pages, on `/start` and on the hero, where the hero primary
  already says it. That leaves one "start" CTA per screen.
- The button label is the verb plus the object ("Send this email", "Save and continue"). Never "Submit", "Next" or
  "OK".

### 4.7 New/changed tokens summary (lane A writes these)

```css
@theme {
  --text-h1: clamp(2rem, 1.6rem + 1.6vw, 2.75rem);      /* was 2.25 → 3.75rem */
  --container-patient: 40rem;   /* 640 px: single patient column (R8 two-thirds of 960) */
  --container-judge: 80rem;     /* 1280 px: judge two-pane */
  --container-reading: 65ch;
}
[data-view="patient"] { --text-body: 1.125rem; }
html { scroll-padding-top: 6rem; }  /* sticky header never hides focus (R31) */
```

---

## 5. Layout system

### 5.1 Widths

| Context | Max width | Notes |
|---|---|---|
| Marketing pages | `page-container` 76rem; text columns ≤ `65ch` | Unchanged |
| **Patient flow** (case home, /start, every patient sub-page) | `max-w-patient` (40rem / 640 px), left-aligned inside `page-container` on desktop, full-bleed with gutter on phones | One column. No rail. |
| **Judge console** | `max-w-judge` (80rem) | Two panes; see 5.3 |
| Forms | 40rem; single inputs at the width the answer needs (postcode 10ch, state 6ch) | GOV.UK input widths |

### 5.2 Patient flow (single column)

```
┌ Safety banner (1 line) ───────────────────────────────────────────┐
├ Header: Orelia · [Your case ▾]           [Patient|Judge] [☰]   ┤
│                                                                   │
│  ‹ Back to your case                     (sub-pages only)         │
│                                                                   │
│  Step 3 of 4 · You choose        ━━━━━━━━━━━━━━━━━━━━━━━━━──────── │  ← one progress line
│                                                                   │
│  Choose who we contact first                       (h1, 1 line)   │
│  We found 6 people and groups who may help.        (1 sentence)   │
│                                                                   │
│  ┌─ action card ───────────────────────────────────────────────┐  │
│  │  …one question / one decision…                              │  │
│  │  [ Primary button ]                                         │  │
│  │  Nothing is sent without your OK.  (small, once)            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ▸ Details: how we found these          (one disclosure)          │
│                                                                   │
│  What's happened                        (3 latest, quiet)         │
│  ✓ Searched 9 public sources · 17 min ago                         │
│                                                                   │
│  Manage case · Delete case               (footer, small)          │
└───────────────────────────────────────────────────────────────────┘
```

- The **4-step patient progress** (Tell us, We search, You choose, We reach out) is the only stepper in patient
  view. It maps the judge's 7 stages as follows:
  - Tell us = case.
  - We search = search.
  - You choose = shortlist, consent and plan.
  - We reach out = outbox, tracker and threads.
- Sub-pages in patient view (shortlist, consent, outbox, tracker…) **render the patient variant**: the same data, a
  single column, a back link to the case home, and no rail or pills. Judge-only blocks are wrapped in `<JudgeOnly>`
  (lane A primitive) so lanes D and E can hide them without forking pages.

### 5.3 Judge view: two-pane console

```
┌ Header: Orelia · EDS (suspected) · case 1324…   [Patient|Judge] ┐
├ Stage bar: Case ✓  Search ✓  Shortlist ✓  [Consent]  Plan  Outbox  Tracker   · Tools ▾ ┤
│ ┌ List pane (≈ 26rem) ───────────┐ ┌ Detail pane (flex) ─────────────────────────┐ │
│ │ Filter: All 16 · Clinics · …   │ │ Stanford EDS Clinic                Best fit │ │
│ │ ───────────────────────────── │ │ Clinic · Palo Alto, CA · Email + call       │ │
│ │ ● Stanford EDS Clinic  Best    │ │                                             │ │
│ │   Clinic · CA · ✓ Checked      │ │ Why it fits (3 lines)                       │ │
│ │ ───────────────────────────── │ │ Score 82  ▸ breakdown                       │ │
│ │ ○ EDS Society         Good    │ │ Sources (3)  ▸                               │ │
│ │   Group · national             │ │ Contact route ▸                             │ │
│ │ ───────────────────────────── │ │                                             │ │
│ │ …                              │ │ [ Add to contacts ]   Verify by phone (link)│ │
│ └────────────────────────────────┘ └─────────────────────────────────────────────┘ │
│ Selection tray (sticky bottom): 2 of 5 chosen · [Continue to consent]               │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **The stage bar replaces both the left rail and the outreach pill row.** It is a single horizontal list of 7
  stages with a teal underline on the current stage and checks on completed ones. It is quiet and does not repeat
  "Step N of 7". "Tools ▾" is a menu holding From research to care, Documents, Medical history, Condition research
  and Review.
- Below 1024 px the list pane comes first. Selecting a row opens the detail as a `Sheet` (a vaul bottom drawer),
  as DESIGN.md already specifies.
- The list pane scrolls on its own; the detail pane is sticky. Keyboard: `j`/`k` move between rows and `Enter`
  opens a row, with a visible "Keys" hint inside Tools, not on the page.
- Pages that have no list (swarm, plan with 1 to 3 items, coordinate) use a single **wide column** (max 52rem) with
  the same stage bar.

---

## 6. Component inventory to rework

| Component | Today | v2 | Lane |
|---|---|---|---|
| `SiteHeader` | 4 to 5 nav items, view toggle, sign in, a 3-way theme toggle and a CTA. Wraps at 1440 px. | Marketing: 3 nav items (How it works, Trust, About), then Sign in and the CTA. Case pages: wordmark, case name menu, view toggle and an account icon. The theme toggle moves into the account menu (a single "Appearance" item). No wrapping at 1024 px or wider. | A |
| `AppShell` | Title block, left rail, main | Gets `mode: "patient" \| "judge"`. Patient mode renders back link + progress + 40rem column. Judge mode renders stage bar + `children` (one column or `TwoPane`). Title is `text-h1` without `emph`. | A |
| `JourneyStepper` (rail) | 7 steps with descriptions and a "Step 4 of 7" bar | Replaced by `StageBar` in judge view and `PatientProgress` (4 segments) in patient view. | A |
| `OutreachNav` | 7 numbered pills plus a header block | Deleted. Its stages fold into `StageBar`. Pages keep a plain `h1` and 1-sentence lede through `PageHeader`. | A (component), D/E (call sites) |
| `PageIntro` (shortlist) | Eyebrow, h1/h2 and a long lede | `PageHeader`: `title` (one line), optional `lede` (at most 1 sentence, 20 words) and optional `action`. No eyebrow in patient view. | A |
| `Stepper` (ui) | Generic | Keep it for intake. Its progressbar gets an accessible name (fixes `aria-progressbar-name`). | A |
| **New `JudgeOnly` / `PatientOnly`** | n/a | Render children only in that view (hydration-safe; default to patient on the server). | A |
| **New `TwoPane`** | n/a | `list`, `detail`, `emptyDetail`. A sheet below 1024 px. | A |
| **New `ListRow`** | Ad-hoc cards | Title, meta line, at most 1 badge (patient) or 2 (judge), optional leading icon or checkbox, trailing chevron. Whole row clickable, 56 px minimum height, hairline divider. | A |
| **New `ActionCard`** | `ActionFrame` (patient), "Your next step" card (judge) | One component for both views: title (the question), optional 1-line lede, body, primary button and a one-line reassurance. One per view. | A (primitive), C (patient usage) |
| **New `Details`** | Accordions, "See details ↗" links | Native `<details>`-style disclosure: "Details: <what>". One level only. Lazily renders its contents. | A |
| `StatusLine` (`LiveStatus`) | Coral "Your turn" dot and "Live: updates on its own" | One line: a teal `Badge` saying "Your turn" or "We're working", plus a timestamp ("Updated 2 min ago"). Live updates are announced through `role="status"`, with no visible "Live" chip. | C |
| `Badge` | 9 tones | Keep the tones, but patient view uses only `teal`, `ok`, `warn` and `danger`. Add a lint check in the `/system` gallery. | A |
| `SourceChip` | Shown on rows, 1 to 3 per item | Only inside Details and the judge detail pane. Rows show "✓ Checked · 3 sources". | A (chip), D (usage) |
| `EvidenceBadge`, `ScoreStack`, `ScoreBar` | On every shortlist card | Judge detail pane only. | D |
| `Stat`/`StatGroup` | "3 of 7 / 0 / 0" stats on the judge home | Remove them from the home. The stage bar already says the same thing, and the stats were stale. | D |
| Tables | Consent field toggles; "The case you confirmed" table | Become `ListRow` summary lists (`<dl>`) with a "Change" link per row (R4). | C, D |
| Empty state | Long copy plus a duplicated CTA | `EmptyState`: title (what will appear), 1 sentence (when), and at most 1 action. Never repeat a header action. | A (primitive), all |
| Loading | 5 to 9 s skeletons; the h1 renders above the header | The skeleton matches the final layout. An h1 placeholder sits inside `main`. After 3 s show a status line: "Still loading your case…". | A |
| Error | Red card inline ("No draft") | `ErrorSummary` at the top (R28): heading "There is a problem", a list of links to the fields, and focus moved to it. Inline errors read as problem plus fix. Red is only used here. | A (primitive), all |
| Dialogs | Approve and delete | Delete: title "Delete this case?", 1-sentence consequence, `danger` button "Delete case", secondary "Keep it". Approve flows are pages, not dialogs. | A |
| Forms (patient) | 9-toggle consent lists, multi-field cards | **One question per page** (R1). Every page has a Back link and "Continue"; validate on Continue (R27); end on a check-answers page (R4). Only fields that have a value appear; "Not on file" rows are hidden behind "Add more details (optional)". | C |
| Selection tray | Sticky, overlaps content | Keep it in judge view. Content gets `pb-24` and `scroll-padding-bottom` so focus is never hidden (R31). Patient view has no tray: selection is in-flow. | D |

---

## 7. Page-by-page redesign

The format for each page is:

- **Goal.**
- **Primary action**, which is exactly one.
- **Shown.**
- **Behind Details.**
- **Before and after** wireframes.
- **Copy changes.**

Patient copy is written at about grade 6 to 8. Unless a page says otherwise, the judge view of that page is the
two-pane console and its density rules apply.

### 7.1 Landing hero (lane B): keep, declutter

**Unchanged:**

- The grid layout (6/6 columns on desktop, stacked on phones).
- The h1 "Find the experts. Get *seen*." and its size, weight and `emph`.
- `HeroField` and `FieldPoster` (the particle field converging on the plan ring): their behaviour, colours,
  timing and mask.
- The legibility wash and `HeroPauseButton` (needed for WCAG 2.2.2).

**The exact element changes:**

| # | Element | Change |
|---|---|---|
| H1 | Eyebrow "FOR ADULTS WITH A RARE DISEASE" with the coral rule | **Keep the words, drop the uppercase.** Sentence case, `text-small font-semibold text-ink-2`. The coral rule stays: it is the one coral accent. |
| H2 | Tagline "Expert finders tell you who the expert is. Orelia gets you seen." (`text-h3` serif) | **Keep.** It becomes the only supporting line. |
| H3 | 4-line body paragraph "Give your details once. Research agents find…" | **Remove** from the hero. Its content moves to the first section ("How it works", below the fold). |
| H4 | Primary "Start your case →" | **Keep.** It is the only primary. |
| H5 | Secondary outlined button "See how it works ↓" | **Demote** to a quiet text link with `ArrowDown`, placed beside the primary (`Button variant="link"`). |
| H6 | Text link "Judge view: watch the agents work" | **Remove.** The header's Patient/Judge toggle already does this. A "For judges" link to `/start?view=judge` moves into the footer and the how-it-works page. |
| H7 | 3 check-bullets (sources, approval, no medical advice) | **Replace** with one quiet line under the CTAs: "Nothing is sent without your OK." The source and no-advice promises live in the safety banner and the Trust section. |
| H8 | Sample-case panel (`AgentRunPanelView`): header, "Illustrative example" pill, "Agents searching 2/5" bar, 5 source rows with spinners, Verified source chips footer, a stacked second card | **Simplify.** Keep the frosted card in the same position so the composition and the convergence ring stay intact. Show 3 lines that cycle with the run script: "Looking in 5 places…", then "Found 8 people and groups", then "Plan ready: 3 to contact". Use one thin progress bar. Remove the source chips footer, the stacked back card, the per-row spinners and the "Illustrative" pill; the panel's top line reads "Example" in `text-small ink-3`. On phones (<640 px) the panel is **hidden**. Hide it from screen readers as now, with an sr-only "Example of a search in progress". |
| H9 | `HeroPauseButton` with label | **Keep** as a visible control, but make it `size="sm"` icon + "Pause". It must stay ≥24 px and keyboard reachable. |
| H10 | Header CTA "Start your case" | **Hide** while the hero is in view (an `IntersectionObserver` on `[data-hero]` toggles a `data-cta-hidden` attribute, with no layout shift because the slot keeps its width). It appears after scrolling past the hero. |
| H11 | Vertical spacing | Add whitespace: h1 to tagline `mt-6` → `mt-8`, tagline to CTAs `mt-8` → `mt-10`. |

```
BEFORE (1440)                                             AFTER (1440)
┌───────────────────────────────────────────────┐        ┌───────────────────────────────────────────────┐
│ — FOR ADULTS WITH A RARE DISEASE   ┌────────┐ │        │ — For adults with a rare disease              │
│ Find the                           │SAMPLE  │ │        │ Find the                    ·  ·  ·           │
│ experts.          · ·(ring)· ·     │[Illus.]│ │        │ experts.          · ·(ring)· ·  ┌──────────┐  │
│ Get seen.                          │2/5 ━━─ │ │        │ Get seen.                       │ Example  │  │
│ Expert finders tell you…           │• Lit 6 │ │        │                                 │ Found 8  │  │
│ Give your details once. Research   │• Tri 2 │ │        │ Expert finders tell you who     │ ━━━━━──  │  │
│ agents find the specialists, …     │• Cen ◌ │ │        │ the expert is. Orelia gets   └──────────┘  │
│ (4 lines)                          │• Adv ◌ │ │        │ you seen.                                     │
│ [Start your case →] [See how ↓]    │• Aid ◌ │ │        │                                               │
│ Judge view: watch the agents work  │Sources │ │        │ [Start your case →]   See how it works ↓      │
│ ✓ claims ✓ approval ✓ no advice    │[✓][✓] │ │        │ Nothing is sent without your OK.              │
│                        [Pause anim]└────────┘ │        │                                     [❚❚ Pause]│
└───────────────────────────────────────────────┘        └───────────────────────────────────────────────┘
CTA-styled controls on screen: 6 → 2 (+1 quiet link).  Badges: 6 → 0.  Words above fold: ~95 → ~30.
```

**Rest of the landing page (lane B):** cut it from 7 sections (10.6k px) to 4 (target ≤ 5k px at 1440 px):

1. Hero.
2. **How it works**: 4 steps in one row of plain text, each with an icon, a title and 1 sentence (Tell us, We
   search, You choose, We reach out, the same as the patient progress). Drop the 4,000 px scrollytelling
   (`StepFrames`); we can keep one static frame per step.
3. **What we never do**: 3 promises only (we never send without your OK; we never give medical advice; we only share
   what you tick). Link to /trust.
4. Final CTA: "Ready when you are." with the primary button.

Remove `ProblemSection`, `HowItAdapts` (its 3 coloured channel cards and table) and `FindsBento` from the landing.
`HowItAdapts` moves to /how-it-works and is kept there in judge-friendly form.

### 7.2 /how-it-works, /trust, /about (lane B)

- **/how-it-works**:
  - Goal: explain the flow to a judge or a curious carer.
  - Primary: "Start your case".
  - Shown: the same 4 steps, each followed by its judge-level detail (agents, verifier, curator) in plain words,
    with the agent names in `text-small` ("Behind the scenes: 9 search agents run at once").
  - Keep `HowItAdapts`, but its channel cards become `ListRow`s with icon tints, not pastel fills.
  - Remove 7 "Example" pills. Cap the page at 2 badges.
- **/trust**: 5 numbered promises, then Details for each. Remove the duplicate 3-column block (Fields, AI disclosure,
  Demo allowlist). "Demo allowlist" becomes "In this demo, messages only go to our own test inboxes."
- **/about**: replace the 4-line h1 with "Why we built Orelia". Remove "Seven steps"; link to /how-it-works
  instead. Use one step count site-wide: **4 steps for patients**, 7 stages for judges.
- Copy: "agent swarm" becomes "a team of search helpers (AI)" for patients and stays "agent swarm" in judge text.

### 7.3 /start: intake (lane C)

**Patient** (already good, so polish it):

- Goal: tell us enough to search. Primary: "Continue".
- Shown:
  - One question per page.
  - A Back link.
  - The question as the h1.
  - A hint of at most 1 sentence.
  - "Upload a report instead" as a link.
- End on **"Check your answers"** (R4), with a "Change" link per row. Its primary is "Start the search".
- Fix the disabled Next. Never disable it: validate on Continue and show the error summary (R27, R28).
- Remove the in-page disclaimer, which duplicates the banner.

**Judge:**

- Goal: paste a report and watch extraction. Primary: "Read the report".
- Remove the 4-chip row and the right-hand 3-item explainer card. Keep **one** 3-step stepper (Share a report,
  Confirm, Start the search).
- Sample-case chips become one `Select` ("Try a sample report").
- The textarea uses the sans font, not mono.

```
JUDGE BEFORE                                      JUDGE AFTER
[Share a report][Confirm][Nine searches][Choose]  ① Share a report ── ② Confirm ── ③ Start the search
① Share ─ ② Confirm ─ ③ Start                     Paste a report or clinic letter
Share a report                ┌ We read it ─┐     ┌───────────────────────────────────────────┐
[sample chips ×3]             │ You check it│     │                                           │
┌ textarea (mono) ┐           │ Nine search │     └───────────────────────────────────────────┘
└─────────────────┘           └─────────────┘     Try a sample report [ Vascular EDS ▾ ]
[Read the report] [Use sample]                    [ Read the report ]
```

### 7.4 Case home (lanes C and D)

**Patient** (lane C). Goal: know the status and do the one next thing. Primary: whatever `nextAction` is.

- `StatusLine`: "Your turn" with "Updated 2 min ago".
- h1: the question, for example "Choose what we may share with The Ehlers-Danlos Society".
- `PatientProgress` with 4 segments.
- `ActionCard` holding the next action. Consent inside it becomes **one question per screen** (see 7.7).
- "What's happened" shows the 3 latest items and a "See all" link.
- The footer has "Manage case" (a link to a small page with Delete, Download and Judge view).

Removals:

- The "Live: updates on its own" chip.
- The judge-view explainer sentence (it moves to "Manage case").
- The red Delete link beside the next step.
- The duplicated "What may we share?" heading inside the card (the h1 already asks it).

```
PATIENT BEFORE                                    PATIENT AFTER
● Your turn  ● Live: updates on its own           Your turn · Updated 2 min ago
Choose what we may share with The EDS Society.    Choose what we may share with
Only what you tick is ever shared…                The Ehlers-Danlos Society
━━━━ ━━━━ ━━━━ ────  (4 steps)                    ━━━━ ━━━━ ━━━━ ──── Step 3 of 4 · You choose
┌──────────────────────────────────────┐          ┌──────────────────────────────────────┐
│ What may we share?                   │          │ Can we tell them your diagnosis?     │
│ Choose what we may share with …      │          │ Ehlers-Danlos syndrome (suspected)   │
│ For: The Ehlers-Danlos Society       │          │ ( ) Yes, share it   ( ) No           │
│ [diagnosis ●] [type: Not on file ○]  │          │ [ Continue ]                         │
│ [report: Not on file ○] [city ○] …×9 │          │ Only what you say yes to is shared.  │
│ [Save what we may share]             │          └──────────────────────────────────────┘
│ See details ↗                        │          ▸ Details: what each detail is used for
└──────────────────────────────────────┘          What's happened
What's happened · Searched 9 public sources       ✓ Searched 9 places · 17 min ago
Want every detail? The judge view … [Delete case] Manage case
```

**Judge** (lane D). Goal: see where the case stands. Primary: the next-step button.

- Stage bar.
- One `ActionCard`: "Next: choose fields to share" with a "Choose fields" button. The heading and the button must
  not repeat the same words.
- A 2-column `<dl>` "Case details" with Change links.
- "Recent activity" as a list.

Removals:

- The "READY" pill (the stage bar shows the stage).
- `StatGroup` (3 of 7 / 0 / 0, which was stale).
- The uppercase eyebrow "WHAT NEEDS YOU NOW".
- The h1 "Where this case stands" plus its 2-line lede. The header already carries the disease name; use a
  `text-h3` "Next step".

### 7.5 Swarm / search (lane D)

**Patient view:**

- Goal: reassure while we search. Primary: none while searching, then "See who we found".
- Shown:
  - The h1 "We're looking in 9 places".
  - One progress bar ("6 of 9 done").
  - At most 3 quiet rows that update ("Found 4 clinics").
- Copy: "This usually takes 2 to 4 minutes. You can close this page. We'll keep going."

**Judge view:**

- Goal: watch the agents. Primary: "Review the shortlist" when done, in the pane header, not at the bottom.
- Keep `SwarmConstellation` (the radar). The 9 agent tiles become a `ListRow` list beside it in `TwoPane`.
- **Hide "Not available yet" tiles** entirely, and list them in Details as "Coming later".
- "queued" becomes "Waiting" with a clock icon and no spinner. After 60 s with no change it shows "Still waiting".
- "Latest sources" chips (8) become a single "Sources (29)" row that opens the detail pane.
- Fix: the progress bars need names (axe), and the agent card labels must contain their visible text.

### 7.6 Shortlist (lane D): the biggest change

**Patient view:**

- Goal: pick up to 5 to contact. Primary: "Continue with 2 chosen".
- h1 "Choose who we contact", lede "We found 16. You can pick up to 5. We suggest these 3." Then **3 suggested rows,
  pre-explained**, each showing:
  - the name;
  - one meta line (type · place · how we'd reach them);
  - a checkbox;
  - at most 1 badge ("Good match").
- "Show 13 more" expands, as one level.
- Each row has one "Why this one?" disclosure with 2 plain sentences and "Checked against 3 sources".
- Never shown to patients: scores, weights, tier pills, "Tune the order", "Verify by phone", filters, tabs.

**Judge view:**

- `TwoPane`. List rows show the name, tier badge, type · state and "✓ Checked".
- The detail pane shows the curator's read (at most 3 lines), then "Score 82 ▸" (the breakdown), "Sources ▸",
  "Contact route ▸", the "Add to contacts" primary and the "Verify by phone" link.
- Filters become one segmented control (All / Clinics / Trials / Groups / Aid) plus a "More filters" popover.
  "Tune the order" moves to Tools ▾ → Review.

Targets:

- Height at 1440 px drops from 11.5k px to ≤ 1.5 screens (the list scrolls internally).
- Words drop from 2,231 to ≤ 400 visible.
- 0 `label-content-name-mismatch` violations.

```
BEFORE (each of 16 cards)                         AFTER patient                     AFTER judge (list row)
┌──────────────────────────────────────────┐      ☐ Stanford EDS Clinic            ● Stanford EDS Clinic   Best
│ CLINIC  [Best fit]                       │        Clinic · Palo Alto · email       Clinic · CA · ✓ Checked
│ Stanford EDS Clinic                      │        Good match                     ───────────────────────────
│ [✓ Verified|stanford.edu|2025] [✓ …]     │        ▸ Why this one?                 ○ EDS Society          Good
│ Sources (3)                              │      ─────────────────────────         Group · national
│ How this scored ━━━━━━━━ 82              │      ☐ The EDS Society
│  +40 subtype · +22 dist · +12 …          │        Support group · national
│ ┌ Contact door found ──────────────────┐ │      …
│ │ intake@… · (650) …   [Verify by phone]│ │      Show 13 more
│ └──────────────────────────────────────┘ │      [ Continue with 2 chosen ]
│ ☐ Select   Nothing is sent until…        │
└──────────────────────────────────────────┘
```

### 7.7 Consent (lane D for judge, lane C for patient)

**Patient:**

- Goal: say yes or no to each detail we have. Primary: "Continue".
- **One detail per screen** (R1), and **only details we actually have** (diagnosis, city, state…).
- Each screen has the question "Can we tell <org> your city?", the value, Yes/No radios, Continue and Back.
- "Add more details (optional)" covers the "Not on file" fields, as one link at the end.
- Ends on a check-answers page, "Here's what <org> will see", with Change links. The primary is "Save and continue".

**Judge:**

- One pane per contact, with the field rows as a compact `<dl>` with switches.
- Hide rows with no value behind "3 more fields (not on file)".
- Remove the "Email · Only route found" pill from the consent page (it belongs to Plan).
- Show "What may we share?" once.

Copy: "Only what you say yes to is shared. Every message says an AI helped write it." appears once, by the button.

### 7.8 Plan (lane D)

- Goal: OK how each contact is reached. Primary: "OK this plan" (judge: "Approve plan & draft messages").
- Shown: one row per contact with the channel icon and a plain line ("Email the main office first. Call if no reply
  in 3 days.").
- Remove:
  - Reorder arrows when there is 1 step (show them only when there are 2 or more).
  - The "Start here" pill (row order says it).
  - The coral "Demo: delivered to Orelia test inbox" pill. It becomes a neutral "Test inbox" badge in judge view
    only.
- "Rebuild plan" moves to a "More" menu.
- The h1 changes from "How we will *reach* each resource" to "How we'll contact them".
- The lede goes from 3 sentences to 1: "Check how we'll reach each one. Nothing is sent until you read it."

### 7.9 Outbox (lane D)

- Goal: read and OK each message. Primary: "Send this email" (per message, one at a time in patient view).
- **Patient:** one message per screen in a well. Shown:
  - "To: Intake team, The EDS Society".
  - "What they'll see" (the ticked fields as a list).
  - The primary button.
  - "Change something" as a link that opens the editor.
  - "Skip for now" as a link.
- **Judge:** `TwoPane` with drafts on the left and the letter, gate checks (allowlist, ticked-fields-only,
  disclosure present) and the approve button on the right.
- **Fix the contradiction.** When a draft could not be written, the empty state is not red:
  - Title: "We need one more answer first".
  - Body: "Tell us what The EDS Society may see, then we'll write the email."
  - Primary: "Choose what to share" (a link to consent).
  - "Nothing is waiting for your approval" shows only when there are truly 0 drafts and 0 blocked drafts.

### 7.10 Tracker and threads (lane D)

- Goal: see who replied and what's next. Primary: the one "Needs you" item, if any, else none.
- **Patient:** h1 "Who we've contacted". Then rows with the name, a status word with an icon (Sent · Replied ·
  Needs you · No reply yet) and the next date ("We'll follow up on Mon 27 Oct").
  - A row with a pending task shows it inline.
  - The 7-segment journey bar becomes a single status word (R5: few statuses).
- **Judge:** the `TwoPane` list of contacts. The detail pane shows the journey timeline (vertical, quiet), the
  thread, transcripts and the walk-away schedule.
- Remove the duplicate card for the same draft ("Needs you now" plus "Each journey").
- The title "Every conversation, one calm view" becomes "Replies and follow-ups".
- Threads merges into the tracker's detail pane. The `/threads` route stays as a deep link that opens the same
  view.

### 7.11 Coordinate (lane D)

- **Judge only** in patient view terms: patients reach it through a task ("Send your records to Stanford").
- Single column, with the board, consults, requirements and packet as `ListRow` sections.
- 1 primary per section at most, and only the section in focus shows a primary; the others show links.

### 7.12 Experts, history, research, documents (lane E)

- **Experts**:
  - Goal: trace authors to clinics. Primary: "Trace authors", **once** in the page header; remove the copy in the
    empty state.
  - Rows are expert to clinic chains in `ListRow`.
  - `VerdictChip` becomes one badge per row.
- **History**:
  - Goal: add records once. Primary: "Add records".
  - Intro goes from 3 lines to 1: "Add letters and test results once. We'll use them when we contact people."
  - The sign-in strip becomes one link line.
  - The dropzone and the paste box become one `Tabs` (Upload / Paste).
  - Fix the unlabeled field.
- **Research** (condition brief):
  - Goal: read a plain summary. Primary: none (it's reading).
  - Keep `LevelLegend` in Details.
  - 65ch column. Evidence levels as a word plus a bar.
  - Patient view shows "What it is", "Who treats it" and "Questions to ask" only.
- **Documents**:
  - **Map raw keys to labels** (`homeCity` → "Your city") and deduplicate.
  - Rows show the label, value and "Shared with: 1 contact".
  - "Sources research found (30)" moves into Details.

### 7.13 Account and auth (lane E)

- The signed-out gate on `/account*`:
  - Title "Sign in to see your account".
  - One primary, "Sign in", plus a "Create an account" link.
  - Fix heading order (h1 → h2).
- **Profile** follows the patient form rules: one section per screen on mobile, labels above fields,
  "(optional)", and validate on Save.
- **Document library**: list rows; upload as the one primary; status as a word.
- **Auth**:
  - Allow paste and autofill.
  - Offer "Email me a sign-in link" next to the password (R33), if the backend supports it. If it doesn't, leave a
    TODO.
- The theme toggle moves here, under "Appearance".

### 7.14 Review (evaluator tool) (lane D)

- **Judge only.** Remove it from the patient flow; it is reached through Tools ▾ → Review.
- It becomes a `TwoPane` with candidates on the left and one review form on the right. There is one "Save review"
  instead of 16 (19 CTAs become 1).

---

## 8. Copy rules and replacements

The rules:

- Grade 6 to 8 for patient text; check with a readability tool such as the `text-readability` npm package or
  Hemingway.
- At most 20 words per sentence and 3 sentences per block.
- Say "you" and "we". Use numerals.
- Use exact dates for follow-ups.

| Today | Patient view v2 | Judge view |
|---|---|---|
| Agent swarm / research agents | We're looking in 9 places | Agent swarm (9 agents) |
| Curator / verifier / final judge | (not shown) | Curator · Verifier · Final judge |
| Shortlist | People who may help | Shortlist |
| Consent | What we may share | Consent |
| Outbox | Messages to check | Outbox |
| Tracker | Who we've contacted | Tracker |
| Approve | OK / Send this email | Approve |
| Resource | person, clinic, group, study or help program (be specific) | Resource |
| "How we order fit: score = …" | (not shown) | Score breakdown (in Details) |
| "Not on file" | (row hidden) | Not on file |
| "Demo: delivered to Orelia test inbox" | (not shown) | Test inbox |
| "Nothing is sent until you approve it." (×4 or more) | Nothing is sent without your OK. (once, by the button) | same |
| "This draft could not be written. Save what this contact may see…" | We need one more answer first. | Draft blocked: no consented fields |
| "Every conversation, one calm view" | Who we've contacted | Replies and follow-ups |
| "Where this case stands" | (status line) | Next step |
| Error: "This field is required" | Tell us your city, or choose "Skip" | same |

---

## 9. Motion rules

| What | Animation | Duration / easing | Why | Reduced motion |
|---|---|---|---|---|
| **Hero particle field** | **Unchanged** (converging particles to the plan ring) | unchanged | Brand signature; shows "many sources, one plan" | `FieldPoster` static SVG (unchanged); pause button for others (R37) |
| Hero sample panel lines | Cross-fade between the 3 lines | 300 ms, `ease-out-expo` | Mirrors the field's progress | Shows the final line, still |
| Button press | Background and colour change | 150 ms | Feedback (R35) | Colour only |
| Disclosure (Details) open | Height via `grid-template-rows` 0fr → 1fr plus a fade | 250 ms in, 200 ms out | Orientation | Instant |
| Patient step to next step | The new question fades and rises 8 px | 300 ms in; the old one leaves at 200 ms | Shows "you moved forward" | Fade 100 ms |
| Progress line advance | `transform: scaleX` | 400 ms | State change | Instant |
| Row selected (judge) | `teal-soft` background | 150 ms | Feedback | Instant |
| Live update arrives | The row flashes `teal-soft`, then settles | 600 ms total (one pulse) | Draws the eye to a new reply, once | No flash; `role="status"` text only |
| Sheet / dialog | Slide or scale-in from 96% | 300 ms in, 200 ms out | Orientation | Fade 150 ms |
| Swarm constellation (judge) | Existing | ≤ 400 ms per node change; loops must pause after the run finishes | Shows parallel work | Static map |
| Toasts | Slide in 8 px | 250 ms | Feedback | Fade |

Banned:

- Animated page transitions on case pages, apart from the existing 350 ms `page-enter`, which we **reduce to 250 ms**.
- Staggered list reveals on patient screens.
- Scroll-linked animation outside marketing pages.
- Spinners anywhere a determinate bar is possible.
- Anything that lasts over 500 ms except the hero field and the swarm.
- Looping motion other than the hero field, which has a pause control. The swarm stops when the run finishes.

---

## 10. Implementation lanes

Five lanes own **disjoint files**. Lane A lands first because it ships the primitives; B to E then run in parallel.
Other feature agents (calendar, needs/judge, accounts, patient view) are still pushing. Each lane must rebase on
`origin/main` before starting, and keep its PR small and surface-scoped.

### Dependency order

```
A (tokens, primitives, shell)  ──►  B (landing + marketing)
                               ──►  C (patient view + intake)
                               ──►  D (judge case pages)
                               ──►  E (rare-disease pages + account)
```

B to E depend only on A's **exported API** (section 6, "New" rows). To avoid blocking, A merges in two PRs:

- **A1:** tokens, `JudgeOnly`/`PatientOnly`, `ListRow`, `ActionCard`, `Details`, `PageHeader`, `TwoPane`,
  `ErrorSummary`. These are additive and nothing uses them yet.
- **A2:** `SiteHeader`, `AppShell` modes, `StageBar`, `PatientProgress`, and the removal of the rail and
  `OutreachNav`. This touches the case layout chrome only.

B can start after A1, and C, D and E can start after A1. A2 merges once D has replaced the `OutreachNav` call sites;
alternatively, A2 keeps `OutreachNav` as a thin wrapper rendering `PageHeader`, so the order does not matter.
**Prefer the wrapper.**

### Lane A: tokens, primitives, shell

Owns:

- `app/styles/theme.css`, `app/styles/tokens.css`, `app/globals.css` (removing the 17 px root rule).
- `components/ui/**`, `components/shell/**`, `components/view-mode/**`, `components/motion/**`, `lib/ui/**`.
- `components/journey/JourneyShell.tsx`, `JourneyStepper.tsx`, `DeleteCaseControl.tsx`.
- `components/outreach/OutreachNav.tsx`.
- `components/shortlist/PageIntro.tsx`, which becomes a re-export of `PageHeader`.
- `app/(design)/system/**` (gallery entries for every new primitive) and `app/layout.tsx`.
- `docs/DESIGN.md`, which A edits to point to v2 and fold in the budgets.

Deliverables:

- Section 4 tokens.
- Section 6 primitives.
- The header that does not wrap.
- `scroll-padding`.
- Progressbar names.
- The skeleton h1 inside `main`.
- `AppShell mode`.
- `StageBar` and `PatientProgress`.
- The theme toggle moved into the account menu.

### Lane B: landing, hero and marketing

Owns:

- `app/page.tsx`, `app/how-it-works/**`, `app/trust/**`, `app/about/**`, `app/not-found.tsx`.
- `components/landing/**`, **except** `components/landing/field/**`, which is read-only. Do not change it, so the
  particle animation stays untouched.
- `components/pitch/**`.

Deliverables:

- The 7.1 hero changes H1 to H11.
- The 4-section landing.
- The 7.2 pages.
- One step count site-wide.

### Lane C: patient view and intake

Owns:

- `components/patient/**`, `components/intake/**`, `app/start/**`, `app/cases/[id]/page.tsx`.
- `components/journey/CaseHome.tsx` (patient parts only, if it is shared), `lib/patient-status/**` (copy strings
  only).
- New `components/patient/flows/**` for the one-question-per-screen consent, message and plan flows, used inside
  `ActionCard`.

Deliverables:

- 7.3 patient and judge intake.
- 7.4 patient home.
- 7.7 patient consent flow.
- The patient variants of 7.5, 7.6, 7.9 and 7.10, as components in `components/patient/views/**`. Lane D's pages
  render these via `<PatientOnly>`.

Note: patient sub-page **components** live in lane C, and the **page files** belong to D or E. D or E add a single
`<PatientOnly><PatientShortlist …/></PatientOnly>` line. This is the only cross-lane touchpoint, and it is
additive.

### Lane D: judge case pages

Owns:

- `app/cases/[id]/{swarm,shortlist,consent,plan,outbox,tracker,threads,coordinate,review}/**`.
- `components/swarm/**`, `components/shortlist/**` (except `PageIntro.tsx`), `components/outreach/**` (except
  `OutreachNav.tsx`), `components/plan/**`, `components/threads/**`, `components/coordinate/**`,
  `components/ranking/**`.
- `components/journey/CaseHome.tsx`: the judge home. If C needs parts of it, C takes a copy into
  `components/patient/`.

Deliverables:

- 7.4 judge home.
- 7.5 to 7.11 and 7.14 judge views.
- `TwoPane` adoption.
- Wiring the lane C patient variants.
- Fixing the shortlist axe issues.

### Lane E: rare-disease pages and account

Owns:

- `app/cases/[id]/{experts,history,research,documents}/**`, `app/account/**`, `app/auth/**`,
  `app/share/**`, `app/review/[token]/**`.
- `components/experts/**`, `components/history/**`, `components/condition-brief/**`, `components/case-docs/**`,
  `components/account/**`.

Deliverables:

- 7.12 and 7.13.
- The raw-key label map for Documents.
- Heading order fixes.

**Shared file conflicts.** None by construction. If a lane needs a primitive change, it asks lane A, or adds a
`cva` variant in a follow-up PR owned by A. No lane edits another lane's files.

---

## 11. Acceptance criteria

These apply to every lane:

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` pass, and `WAYFINDER_OFFLINE=1 npx tsx
      scripts/demo-offline.ts --all` exits 0.
- [ ] **axe-core**: 0 violations (all impacts) on every page the lane owns, in both views, at 375 px and 1440 px,
      both themes. The `region` rule is fixed globally by lane A (the safety banner gets a landmark).
- [ ] **No horizontal overflow** at 320, 375, 768, 1024, 1440 and 1920 px (`scrollWidth ≤ innerWidth`).
- [ ] **Budgets**, counted by the audit script (`audit-script/audit.mjs` logic, ported to
      `scripts/ui-budget.ts` by lane A):
  - Primary buttons per view: exactly 1 when there is an action, else 0.
  - Distinct content font sizes per view: ≤ 4 patient, ≤ 5 judge, ≤ 6 marketing. That is 3 content sizes plus
    small; header chrome is excluded.
  - Badges per row or card: ≤ 1 patient, ≤ 2 judge.
  - Distinct text colours per view: ≤ 5.
- [ ] Copy: patient strings score grade ≤ 8 (Flesch-Kincaid) and contain no word from the banned list (agent, swarm,
      curator, verifier, allowlist, resource, score, rank, tier, pipeline).
- [ ] Reduced motion: with `prefers-reduced-motion: reduce`, no transform animation runs (checked with Playwright
      `reducedMotion: 'reduce'`).
- [ ] Keyboard: every action is reachable. Focus is visible and never covered by the sticky header or tray. The
      Details disclosure is operable with Enter and Space.
- [ ] Screenshots saved in the PR: for each owned page, 375 and 1440 px, light and dark, patient and judge where
      applicable.

**Lane A:**

- [ ] `/system` shows every new primitive in both themes.
- [ ] The header does not wrap at 1024, 1280 or 1440 px on marketing and case pages.
- [ ] The case pages show **one** navigation system (stage bar or patient progress).
- [ ] `JudgeOnly`/`PatientOnly` produce no hydration warnings.
- [ ] Root font size follows the browser. Test with the browser set to 20 px: there is no overflow at 375 px.
- Screenshots: /system, and the case header in both modes at 375 and 1440 px.

**Lane B:**

- [ ] The hero h1 text, size and `emph` are unchanged (visual diff of the h1 region < 1%).
- [ ] `components/landing/field/**` has no diff (`git diff --stat` is empty for that path).
- [ ] Above the fold at 1440 × 900: ≤ 2 button-styled controls in the hero, 0 badges, ≤ 35 words.
- [ ] At 375 px the sample panel is hidden and the h1, tagline and CTA fit in the first 812 px.
- [ ] Landing height at 1440 px ≤ 5,000 px. Site-wide step count is consistent.
- Screenshots: landing fold and full page (patient and judge), plus /how-it-works, /trust and /about, at 375 and
  1440 px.

**Lane C:**

- [ ] Every patient question screen has 1 question, 1 primary, a Back link and a check-answers page at the end.
- [ ] Validation runs on Continue, and the error summary takes focus.
- [ ] Consent shows only fields with values. "Not on file" appears in 0 patient screens.
- [ ] Patient case home at 375 px: the status, h1 and primary button are visible without scrolling.
- Screenshots: /start (patient: first question, an error state, check answers; judge: paste), and case home
  through each `nextAction` kind that can be reproduced with the synthetic fixtures.

**Lane D:**

- [ ] Shortlist at 1440 px judge: page height ≤ 1.5 × viewport, and the list scrolls in its pane. Patient: ≤ 400
      visible words.
- [ ] 0 `label-content-name-mismatch`, `landmark-unique` or `aria-valid-attr-value` violations.
- [ ] Outbox: no red empty state, and the blocked-draft state links to consent.
- [ ] Plan: no reorder controls for a single step. "Test inbox" appears only in judge view.
- [ ] Review: 1 save button.
- [ ] Judge home: no stale stats. The next-step heading does not repeat the button label.
- Screenshots: each owned page in both views at 375 and 1440 px, plus the `Sheet` detail at 375 px.

**Lane E:**

- [ ] Documents shows no camelCase keys and no duplicate rows.
- [ ] Experts has a single "Trace authors". History has no unlabeled fields.
- [ ] `/account*` heading order is valid. Auth allows paste and autofill (`autocomplete` attributes are set).
- Screenshots: experts, history, research, documents, /account (signed-out gate), /auth/sign-in and sign-up, at
  375 and 1440 px.

---

## 12. Out of scope

- Out of scope: new colours or fonts, a new hero concept, and any change to safety gates (lib/safety), outbound
  rules or the AI disclosure text. Copy changes must keep every legally or safety-required sentence, even if we
  shorten what surrounds it.
- Not touched by this spec: the `Appointments` calendar UI (another feature agent's lane). When it lands, it joins
  the judge stage bar as an 8th stage and the patient "We reach out" step.
