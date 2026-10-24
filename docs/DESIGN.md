# Wayfinder design system: Clear Day

Live guide: `/system` (`app/(design)/system/page.tsx`). Every token and primitive is shown there in both themes.
Source of truth: `app/styles/theme.css` (tokens), `app/styles/tokens.css` (legacy), `lib/ui/fonts.ts` (type).

## Direction

Wayfinder helps worried adults with a rare disease, and the people caring for them, get seen. The interface should
feel like a trusted friend who has done the research and written it down clearly: **crisp, calm, human**. Clear Day
(successor to "Warm Paper") is a bright, white, trustworthy surface: clinical-clean without being cold.

- Near-white page, white cards, cool grey bands, near-black blue-grey ink, one deep teal for action.
- Mint (`sage`), coral (`terracotta`) and sun (`gold`) are quiet accents, never text. Indigo, violet and rose are
  semantic hues for contact channels and source types.
- Type: Newsreader (crisp literary serif, optical sizes) for display and h1-h3; Atkinson Hyperlegible Next for
  everything people read or operate (chosen for low-vision legibility, which matters for this audience). Avoid
  all-caps tracked eyebrows above every heading and the one-italic-word headline trick as default moves; use them
  sparingly if at all.
- Depth from layered, low-opacity blue-grey shadows; grain is near-invisible (0.025).
- Motion explains a change, then gets out of the way.
- WCAG AA minimum. Meaning never depends on colour alone.
- Light (white) is the default. Dark ("Night", deep blue-grey `#0b111b`) follows the OS or `[data-theme="dark"]`.

### Hero signature

The landing hero is a "many sources converging on one center" particle field: papers, trials, centers and aid
programs, colour-coded with the `src-*` tokens, resolving into the patient's plan. WebGL via `ogl`; a static SVG
poster is used for reduced motion and when WebGL is unavailable.

## Setup (how it is wired)

- `app/styles/theme.css` is the only global stylesheet import (from `app/layout.tsx`). It loads Tailwind v4, the
  Clear Day tokens, and the legacy `app/styles/tokens.css` + `app/globals.css` inside a `legacy` cascade layer.
- Layer order: `theme, base, legacy, components, utilities`. **Tailwind utilities always beat legacy CSS**, whatever
  the specificity. Component `.css` files imported by components are unlayered and still beat utilities: when you
  migrate a component, delete its `.css` rules rather than fighting them.
- **Tailwind preflight is off** (legacy pages rely on UA defaults). Two replacements:
  - Every primitive carries `data-slot`; the `components` layer resets legacy `button`/`input`/`a`/heading styles on
    `[data-slot]` elements.
  - Put **`ds-root`** on the root element of any page you migrate (AppShell and `/system` already do). Inside it,
    margins, list bullets, legacy heading sizes and bare control styling are reset, like preflight.
- Legacy `--wf-*` variables and the old `--ink/--paper/--line...` names now resolve to Clear Day tokens, so
  unmigrated pages already follow the palette and both themes. Do not use `--wf-*` in new code.
- Note: legacy `globals.css` sets `html { font-size: 17px }`, so `1rem = 17px` until that rule is removed when the
  last legacy page migrates (and it should be: it overrides the reader's browser font size).
- Theme: follows the OS; `<html data-theme="light|dark">` forces it (ThemeToggle persists the choice in
  localStorage; a pre-paint script in the layout applies it). Any element can force a theme for its subtree with
  `data-theme`.

## Tokens

Use Tailwind classes. Raw CSS variables (`var(--teal)`) are for the rare arbitrary value.

### Colour (`bg-*`, `text-*`, `border-*`, `ring-*`, `fill-*`, `stroke-*`, with `/opacity`)

Token NAMES are unchanged from Warm Paper for compatibility; their meaning shifted (sage reads as mint, terracotta
as coral, gold as sun).

| Token | Light | Dark (Night) | Use |
|---|---|---|---|
| `paper` | #FBFCFD | #0B111B | Page background |
| `paper-2` | #F1F4F8 | #111926 | Cool grey bands, inset wells, tracks |
| `card` | #FFFFFF | #151E2C | Cards, dialogs, inputs |
| `ink` | #0E1726 | #E9EEF5 | Headings, body |
| `ink-2` | #3D4A5C | #AEB9C8 | Secondary text |
| `ink-3` | #5A6779 | #8D99AA | Captions, placeholders |
| `line` / `line-strong` | #E2E7EE / #C9D2DD | #233044 / #33435A | Hairlines / control borders |
| `teal` | #0B6B66 | #5CC8BE | Primary action, links, focus |
| `teal-ink` | #08504C | #86DCD3 | Hover / pressed teal |
| `teal-soft` | #E3F2F0 | #12302F | Selected rows, tints |
| `on-teal` | #FFFFFF | #06110F | Text on teal (6.35:1) |
| `sage` / `sage-soft` | #8CCFC2 / #E6F5F2 | #6FB5A8 / #142A27 | Mint: calm emphasis, panels. Accent only |
| `terracotta` / `-soft` | #E5603F / #FDE9E3 | #F0876B / #3A211B | Coral: accent marks only. **Never text** |
| `gold` / `gold-soft` | #F2B630 / #FDF3DA | #F3C55A / #33290F | Sun: highlights, safety banner. **Never text** |
| `indigo` / `-soft` | #3B4FD8 / #E8EBFD | #8C9BFF / #1C2347 | Email, papers |
| `violet` / `-soft` | #7A3FD6 / #F1E9FC | #B79BFA / #2A1D45 | Apply, trials |
| `rose` / `-soft` | #B8326B / #FBE7EF | #F28AB5 / #3A1828 | Call, financial aid |
| `ok` / `ok-soft` | #1E7A4C / #E2F3E9 | #6FD39C / #12301F | Verified, sourced |
| `warn` / `warn-soft` | #B26A00 / #FDF1DC | #F0B455 / #33260F | Emerging; icons and borders only |
| `warn-ink` | #8F5200 | #F5C77A | Warning **text** |
| `danger` / `danger-soft` | #C0352B / #FBE6E4 | #F28B82 / #3A1C1B | Errors, destructive |
| `ring`, `overlay` | | | Focus ring, modal scrim |

Tailwind's default palette is removed: `bg-white`, `text-gray-500`, `bg-red-600` do not exist. That is intentional.

#### Semantic colour

Use the alias, not the underlying hue, so meaning can be retuned in one place. All are Tailwind colours and CSS
vars, with dark equivalents; `-soft` variants exist for `ch-*`.

| Meaning | Token | Resolves to |
|---|---|---|
| Contact channel: email | `ch-email` | indigo |
| Contact channel: call | `ch-call` | rose |
| Contact channel: apply | `ch-apply` | violet |
| Source: paper | `src-paper` | indigo |
| Source: trial | `src-trial` | violet |
| Source: center | `src-center` | teal |
| Source: financial aid | `src-aid` | rose |
| Verified / sourced | `ok` (`--verified`) | green |
| Emerging / warning | `warn`, `warn-ink` (`--emerging`) | amber |

#### Contrast (WCAG, light)

| Token | on paper `#FBFCFD` | on paper-2 `#F1F4F8` | Notes |
|---|---|---|---|
| `ink` | 17.5 | 16.3 | |
| `ink-2` | 8.8 | 8.2 | |
| `ink-3` | 5.6 | 5.2 | |
| `teal` | 6.2 | 5.8 | White on teal 6.35 |
| `indigo` | 6.2 | 5.8 | |
| `violet` | 5.8 | 5.4 | |
| `rose` | 5.5 | 5.1 | |
| `danger` | 5.4 | 5.0 | |
| `ok` | 5.2 | 4.8 | |
| `warn-ink` | 6.1 | 5.6 | |
| `warn` | 4.1 | n/a | Large text and icons only |
| `terracotta` | 3.4 | n/a | Decorative only |

On their `-soft` backgrounds: teal 5.5, indigo 5.4, violet 5.1, rose 4.8, warn-ink 5.6, ok 4.6. In dark, every text
token is at least 6.5:1 on `#0B111B`. `sage`, `terracotta` and `gold` are never text.

**Never hardcode colours; tokens only.** No hex, `rgb()`, `hsl()` or new CSS variables in components or pages. The
only exceptions are inside `theme.css` itself and canvas/WebGL code that must read tokens at runtime via
`getComputedStyle` (it still takes its values from the `--src-*` variables).

### Type

Families: `font-display` (Newsreader via `--font-serif`; `--font-fraunces` is kept as an alias, but prefer
`var(--font-serif)` in new code), `font-sans` (Atkinson, the body default), `font-mono`.

| Class | Size | Family / weight |
|---|---|---|
| `text-display` | clamp(2.75rem → 5.75rem) | Newsreader 300, hero only |
| `text-h1` | clamp(2.25rem → 3.75rem) | Newsreader 300 |
| `text-h2` | clamp(1.75rem → 2.625rem) | Newsreader 300-400 |
| `text-h3` | clamp(1.375rem → 1.75rem) | Newsreader 400 |
| `text-h4` | clamp(1.125rem → 1.3125rem) | Atkinson 700 (or the serif in accordions) |
| `text-lead` | clamp(1.125rem → 1.375rem) | Atkinson, ledes |
| `text-body` | clamp(1rem → 1.0625rem) | Atkinson |
| `text-small` | 0.875rem | Atkinson |
| `text-micro` | 0.75rem, tracked | Atkinson 700: labels. Caps eyebrows sparingly |
| `text-mono` | 0.8125rem | Mono: ids, token names |

Rationale: Fraunces' soft, wonky warmth matched cream paper; on white a sharper serif reads clinical-trustworthy yet
human. Helpers: `display-soft` (optical sizing; the SOFT axis is a Fraunces leftover and is harmless), `emph` (serif
italic in teal). Use `emph` sparingly, not as a default headline move. `text-balance` on headings, `text-pretty` on
ledes.

### Space, size, shape

- Spacing is Tailwind's 4px scale (`p-4`, `gap-6`...). Named rhythm steps: `gutter` (page side padding),
  `stack` (between groups), `section` (between page sections): `py-section`, `gap-stack`, `px-gutter`.
- `page-container`: max 76rem, centred, gutter padding. `max-w-prose` = 68ch for reading.
- Radii: `rounded-sm` 6px (small controls), `rounded-md` 12px (inputs, buttons, menus), `rounded-lg` 20px (cards,
  dialogs, sheets), `rounded-pill`. No other radii.
- Elevation: `shadow-xs` (resting controls), `shadow-sm` (buttons), `shadow-md` (raised cards), `shadow-lg` (menus,
  hovered cards), `shadow-xl` (dialogs), `shadow-inset` (wells, tracks, pressed). Shadows are layered, low-opacity blue-grey ink.
- Texture: `grain` adds a near-invisible noise (0.025) behind a container's content (it sets `position: relative; isolation:
  isolate`). Use on large bands (heroes, footers, empty states), not on every card.

### Motion

- CSS: `duration-150` (hover, colour), `duration-300` (toggles, tabs), `duration-500` (panels, reveals),
  `duration-700` (progress, page-level). Curve: `ease-out-expo` = cubic-bezier(0.16, 1, 0.3, 1). Variables:
  `--duration-fast|base|slow|slower`.
- JS (`lib/ui/motion.ts`): `DURATION`, `EASE_OUT_EXPO`, `SPRING.gentle|soft|snappy|lively`, `TWEEN.fast|base|slow`,
  `RISE` variants. The existing `lib/motion/*` tokens and components keep working.
- Animate `transform`, `opacity`, `clip-path` only. Never width/height/top/left/margin.
- Reduced motion: `MotionConfig reducedMotion="user"` is global (Providers), the legacy CSS rule clamps all CSS
  transitions, and every primitive adds `motion-reduce:` overrides. Your code must too: gate JS animation with
  `useReducedMotionGate()` (`lib/motion/MotionPreference`) and add `motion-reduce:transition-none` /
  `motion-reduce:animate-none` to any class-based motion.
- Smooth scroll: `LenisProvider` (`components/shell`) is for **marketing pages only**. Wrap the page, never the app.
  It disables itself for reduced motion and coarse pointers, and is driven by the GSAP ticker so ScrollTrigger stays
  in sync. `useLenis()` returns a ref (read it in handlers).

## Components

Import primitives from `@/components/ui`, shell pieces from `@/components/shell`.

| Primitive | Notes |
|---|---|
| `Button` | `variant`: primary (one per view) / secondary / ghost / link / danger. `size`: sm (36px) / md (44px) / lg (52px). `loading` + `loadingText` (sets aria-busy, keeps label). `asChild` to style a `Link`. |
| `IconButton` | Required `label` (accessible name + tooltip title). Defaults to ghost. |
| `Surface` / `Card` | `variant`: flat / raised / inset. `padding`: none/sm/md/lg. `radius`: md/lg. `interactive` adds hover lift (wrap a Link with `asChild`). Parts: `CardHeader`, `CardEyebrow`, `CardTitle`, `CardDescription`, `CardFooter`. |
| `Badge` | `tone`: neutral, teal, sage, gold, accent, ok, warn, danger, outline. `size` sm/md. `dot`. Always words, not colour alone. |
| `SourceChip` | `url`, `verified` (required), `date?`, `domain?`, `title?`. Shield vs dashed circle + "Verified/Unverified" word. Opens in a new tab with `rel="noopener noreferrer"`, announces it. Non-http URLs render as text. |
| `EvidenceBadge` | `level`: strong / moderate / limited / unverified. `sources?`, `showHint?`. Bar meter + written level. |
| `Input`, `Textarea`, `Label`, `Field` | `Field label htmlFor hint? error? optional?` wires label/hint/error; pass `aria-describedby` and `aria-invalid` on the control. 44px controls. |
| `Checkbox`, `RadioGroup`/`RadioGroupItem`, `Switch`, `ChoiceRow` | `ChoiceRow title description` makes a whole card the hit target and lights up when checked. Switch is for instant settings only. |
| `Select` + `SelectTrigger/Value/Content/Item/Group/Label/Separator` | Radix select styled as a control. |
| `Tabs` + `TabsList variant="underline" \| "pill"` / `TabsTrigger` / `TabsContent` | |
| `Accordion` + `AccordionItem/Trigger/Content` | Serif triggers, rotating plus. |
| `Tooltip/TooltipTrigger/TooltipContent` | Supplementary only: never the only place information lives. |
| `Popover/PopoverTrigger/PopoverContent/PopoverClose` | |
| `Dialog` + `DialogContent/Header/Title/Description/Footer/Close/Trigger` | Decisions (approve, delete). Close button built in (`showClose`). |
| `Sheet` | `title`, `description?`, `trigger?`, `footer?`, `open?/onOpenChange?`, `side?`. vaul bottom drawer under 768px, side panel above. `SheetClose` wraps a child to close it. |
| `Toaster` / `toast` | Mounted in Providers. `toast.success/error/info/warning/loading/promise`. For confirming what the person did, not for agent results. |
| `Progress` | `value`, `max`, `label?`, `valueText?` (also aria-valuetext), `tone` teal/ok/warn. |
| `Skeleton` | aria-hidden; mark the loading region `aria-busy`. Shimmer stops under reduced motion. |
| `Separator`, `Kbd` | |
| `EmptyState` | `icon?`, `title`, `description?`, `action?`. Say what will appear and the one next step. |
| `Stepper` | `steps: {id,label,description?}[]`, `current` (index), `orientation` horizontal (stacks on phones) / vertical, `renderLabel?`. aria-current="step" + sr-only state text. The patient journey. |
| `Stat` / `StatGroup` | One number in the serif with a quiet label; `StatGroup` is the `<dl>`. |
| `AvatarInitials` | `name`, `size` sm/md/lg. Stable tone per name. |
| `useMediaQuery(query)` / `DESKTOP_QUERY` | SSR-safe (useSyncExternalStore). |

Shell (`@/components/shell`):

- `SiteHeader` (`nav?`, `cta?`): sticky, translucent paper with blur, wordmark, nav, theme toggle, mobile Sheet menu.
- `SiteFooter`.
- `AppShell` (`eyebrow`, `title`, `lede`, `actions`, `sidebar`, `nav`): case pages. Includes the header, an editorial
  title block, a sticky left rail (put a vertical `Stepper` there) and `<main id="main">`. Applies `ds-root`.
- `SafetyBanner`: same name and props as before; already in the root layout. Do not add another.
- `Providers`: in the root layout (MotionConfig, Toaster, tooltip delay). `ThemeToggle`, `Wordmark`,
  `LenisProvider`/`useLenis`, `useThemePreference`/`setThemePreference`/`useResolvedTheme`.
- Pure helpers in `lib/ui/format.ts` (`parseSource`, `formatSourceDate`, `getInitials`, `toPercent`), `cn` in
  `lib/ui/cn.ts`.

## Rules for page lanes

1. **Tailwind classes with Clear Day tokens only; never hardcode colours.** No hex values, no `rgb()`, no new CSS variables, no new colours.
   If you need a colour that is not in the table, ask; do not invent one. Arbitrary values only for geometry.
2. **Use `components/ui` primitives** for every button, input, badge, card, dialog, tab, etc. Do not restyle a raw
   `<button>`. If a primitive is missing a variant, add it to the primitive (cva), not to the page.
3. **Put `ds-root` on the page root** when migrating, and delete the page's legacy CSS rules as you replace them.
   Remove a component `.css` import once nothing uses it.
4. **`next/link` `Link` for every internal link** (with `Button asChild` when it should look like a button). Plain
   `<a>` only for external URLs, always `target="_blank" rel="noopener noreferrer"` and an accessible hint, or use
   `SourceChip`.
5. **No synchronous `setState` inside `useEffect`.** Derive during render; subscribe to browser state with
   `useSyncExternalStore` (`useMediaQuery`, the theme store); reset with `key`.
6. **Server Components by default.** `"use client"` only where there is state, effects or handlers. Never export
   plain data (arrays, strings) from a `"use client"` file for server use: it arrives as a client reference.
7. Accessibility: focus rings stay visible (`focus-ring`); 44px targets for primary controls; every icon-only control
   has a label; status = icon/word + colour; `aria-live`/`role="status"` for agent progress; respect reduced motion.
8. Hierarchy: one primary button per view; `emph` at most once per headline, and rarely; the serif for headings, Atkinson for
   everything operated. Vary spacing deliberately (`stack`, `section`), do not pad everything the same.
9. Keep the safety line visible (root layout). Never phrase UI copy as medical advice.

## Do / don't

| Do | Don't |
|---|---|
| `bg-card border border-line shadow-md rounded-lg` | `bg-white shadow-2xl rounded-3xl` |
| `text-warn-ink` for warning text | `text-warn` for small text (fails AA) |
| Coral (`terracotta`) as a 1px rule or a dot | Coral, mint or sun as text or buttons |
| `ch-*` / `src-*` aliases for channel and source colour | Raw `indigo`/`rose` for meaning, or hex values |
| `Badge tone="ok"` with the word "Verified" | A green dot with no text |
| `motion-reduce:animate-none` beside any animation | Scroll-jacking the app; Lenis on case pages |
| `emph` on one word, rarely | Italic words sprinkled through body copy |
| `Sheet` for detail on mobile | A centred modal on a 375px screen |
