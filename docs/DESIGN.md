# Wayfinder design system: Warm Paper

Live guide: `/system` (`app/(design)/system/page.tsx`). Every token and primitive is shown there in both themes.

## Direction

Wayfinder helps worried adults with a rare disease, and the people caring for them, get seen. The interface should
feel like a trusted friend who has done the research and written it down clearly: **calm, warm, editorial, human**.
Never clinical-cold, never crypto-flashy.

- Warm paper surfaces, deep ink, one teal for action.
- Sage and gold for quiet emphasis; terracotta is a rare accent mark.
- Editorial type: Fraunces headlines (light, optical size) with one italic emphasised word; Atkinson Hyperlegible
  Next for everything people read or operate.
- Depth from layered, warm, low-opacity shadows and a faint paper grain, not from gradients or glow.
- Motion explains a change, then gets out of the way.
- WCAG AA minimum. Meaning never depends on colour alone.

## Setup (how it is wired)

- `app/styles/theme.css` is the only global stylesheet import (from `app/layout.tsx`). It loads Tailwind v4, the
  Warm Paper tokens, and the legacy `app/styles/tokens.css` + `app/globals.css` inside a `legacy` cascade layer.
- Layer order: `theme, base, legacy, components, utilities`. **Tailwind utilities always beat legacy CSS**, whatever
  the specificity. Component `.css` files imported by components are unlayered and still beat utilities: when you
  migrate a component, delete its `.css` rules rather than fighting them.
- **Tailwind preflight is off** (legacy pages rely on UA defaults). Two replacements:
  - Every primitive carries `data-slot`; the `components` layer resets legacy `button`/`input`/`a`/heading styles on
    `[data-slot]` elements.
  - Put **`ds-root`** on the root element of any page you migrate (AppShell and `/system` already do). Inside it,
    margins, list bullets, legacy heading sizes and bare control styling are reset, like preflight.
- Legacy `--wf-*` variables and the old `--ink/--paper/--line...` names now resolve to Warm Paper tokens, so
  unmigrated pages already follow the palette and both themes. Do not use `--wf-*` in new code.
- Note: legacy `globals.css` sets `html { font-size: 17px }`, so `1rem = 17px` until that rule is removed when the
  last legacy page migrates (and it should be: it overrides the reader's browser font size).
- Theme: follows the OS; `<html data-theme="light|dark">` forces it (ThemeToggle persists the choice in
  localStorage; a pre-paint script in the layout applies it). Any element can force a theme for its subtree with
  `data-theme`.

## Tokens

Use Tailwind classes. Raw CSS variables (`var(--teal)`) are for the rare arbitrary value.

### Colour (`bg-*`, `text-*`, `border-*`, `ring-*`, `fill-*`, `stroke-*`, with `/opacity`)

| Token | Light | Dark (Night Paper) | Use |
|---|---|---|---|
| `paper` | #FAF6EF | #141A19 | Page background |
| `paper-2` | #F3EDE2 | #1A2120 | Alt bands, inset wells, tracks |
| `card` | #FFFDF9 | #1E2725 | Cards, dialogs, inputs |
| `ink` | #1F2A2A | #EFE8DC | Headings, body (13.7:1) |
| `ink-2` | #4A5654 | #B8B0A3 | Secondary text (7.1:1 on paper, 6.6:1 on paper-2) |
| `ink-3` | #5F6866 | #9A9387 | Captions, placeholders, eyebrows (5.2:1) |
| `line` / `line-strong` | #E6DED0 / #D3C8B5 | #2C3634 / #3D4A47 | Hairlines / control borders |
| `teal` | #1F5E5B | #7CC1B9 | Primary action, links, focus (6.9:1) |
| `teal-ink` | #164745 | #9FD4CD | Hover / pressed teal |
| `teal-soft` | #E1EBE8 | #1D2F2D | Selected rows, tints |
| `on-teal` | #FFFDF9 | #0F1716 | Text on teal |
| `sage` / `sage-soft` | #A8C3B0 / #E3ECE5 | #7FA08A / #1F2B25 | Calm emphasis, panels |
| `terracotta` / `-soft` | #D9805F / #F7E3D9 | #E8917A / #33231E | Accent marks only. **Never text.** |
| `gold` / `gold-soft` | #E8C98A / #F6ECD6 | #E0BF7E / #2C261A | Highlights, safety banner |
| `ok` / `ok-soft` | #2F6B4F / #E1EDE4 | #86C7A2 / #1A2C22 | Verified, done (5.8:1) |
| `warn` / `warn-soft` | #A86B12 / #F6EAD3 | #E0AE5A / #2E2516 | Warning icons and borders (4.1:1: not for text) |
| `warn-ink` | #8A560B | #E9BF75 | Warning **text** (5.7:1) |
| `danger` / `danger-soft` | #B4432F / #F6E1DA | #E8917A / #35201B | Errors, destructive (5.2:1) |
| `ring`, `overlay` | | | Focus ring, modal scrim |

Tailwind's default palette is removed: `bg-white`, `text-gray-500`, `bg-red-600` do not exist. That is intentional.

### Type

Families: `font-display` (Fraunces), `font-sans` (Atkinson, the body default), `font-mono`.

| Class | Size | Family / weight |
|---|---|---|
| `text-display` | clamp(2.75rem → 5.75rem) | Fraunces 300, hero only |
| `text-h1` | clamp(2.25rem → 3.75rem) | Fraunces 300 |
| `text-h2` | clamp(1.75rem → 2.625rem) | Fraunces 300-400 |
| `text-h3` | clamp(1.375rem → 1.75rem) | Fraunces 400 |
| `text-h4` | clamp(1.125rem → 1.3125rem) | Atkinson 700 (or Fraunces in accordions) |
| `text-lead` | clamp(1.125rem → 1.375rem) | Atkinson, ledes |
| `text-body` | clamp(1rem → 1.0625rem) | Atkinson |
| `text-small` | 0.875rem | Atkinson |
| `text-micro` | 0.75rem, tracked | Atkinson 700 uppercase: eyebrows, labels |
| `text-mono` | 0.8125rem | Mono: ids, token names |

Helpers: `display-soft` (optical sizing + SOFT axis on Fraunces; add to every Fraunces heading), `emph` (Fraunces
italic in teal for the one emphasised word: `<h1>Get <em className="emph">seen</em>, sooner.</h1>`). One `emph`
per headline, at most. `text-balance` on headings, `text-pretty` on ledes.

### Space, size, shape

- Spacing is Tailwind's 4px scale (`p-4`, `gap-6`...). Named rhythm steps: `gutter` (page side padding),
  `stack` (between groups), `section` (between page sections): `py-section`, `gap-stack`, `px-gutter`.
- `page-container`: max 76rem, centred, gutter padding. `max-w-prose` = 68ch for reading.
- Radii: `rounded-sm` 6px (small controls), `rounded-md` 12px (inputs, buttons, menus), `rounded-lg` 20px (cards,
  dialogs, sheets), `rounded-pill`. No other radii.
- Elevation: `shadow-xs` (resting controls), `shadow-sm` (buttons), `shadow-md` (raised cards), `shadow-lg` (menus,
  hovered cards), `shadow-xl` (dialogs), `shadow-inset` (wells, tracks, pressed). Shadows are warm ink, layered.
- Texture: `grain` adds the paper noise behind a container's content (it sets `position: relative; isolation:
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
| `Accordion` + `AccordionItem/Trigger/Content` | Fraunces triggers, rotating plus. |
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
| `Stat` / `StatGroup` | One number in Fraunces with a quiet label; `StatGroup` is the `<dl>`. |
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

1. **Tailwind classes with Warm Paper tokens only.** No hex values, no `rgb()`, no new CSS variables, no new colours.
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
8. Hierarchy: one primary button per view; one `emph` word per headline; Fraunces for headings, Atkinson for
   everything operated. Vary spacing deliberately (`stack`, `section`), do not pad everything the same.
9. Keep the safety line visible (root layout). Never phrase UI copy as medical advice.

## Do / don't

| Do | Don't |
|---|---|
| `bg-card border border-line shadow-md rounded-lg` | `bg-white shadow-2xl rounded-3xl` |
| `text-warn-ink` for warning text | `text-warn` for small text (fails AA) |
| Terracotta as a 1px rule or a dot | Terracotta text or buttons |
| `Badge tone="ok"` with the word "Verified" | A green dot with no text |
| `motion-reduce:animate-none` beside any animation | Scroll-jacking the app; Lenis on case pages |
| A single `<em className="emph">` in a headline | Italic words sprinkled through body copy |
| `Sheet` for detail on mobile | A centred modal on a 375px screen |
