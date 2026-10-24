import { cn } from "@/lib/ui/cn";
import { COLOR_GROUPS, DURATIONS, RADII, SHADOWS, SPACE, TYPE_SCALE } from "./tokens-data";
import { Emph, Section, SubHead } from "./Section";

function Palette({ theme }: { theme: "light" | "dark" }) {
  return (
    <div data-theme={theme} className="grain rounded-lg border border-line bg-paper p-5 text-ink shadow-sm sm:p-7">
      <p className="m-0 mb-6 flex items-baseline justify-between gap-4">
        <span className="font-display text-h3 font-normal display-soft">
          {theme === "light" ? "Warm Paper" : "Night Paper"}
        </span>
        <span className="font-mono text-mono text-ink-3">data-theme=&quot;{theme}&quot;</span>
      </p>
      <div className="grid gap-7">
        {COLOR_GROUPS.map((group) => (
          <div key={group.title}>
            <SubHead>{group.title}</SubHead>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 xl:grid-cols-5">
              {group.tokens.map((token) => (
                <li key={token.name} className="grid content-start gap-2">
                  <span
                    aria-hidden
                    className={cn("block h-14 rounded-md ring-1 ring-inset ring-ink/10", token.swatch)}
                  />
                  <span className="grid gap-0.5">
                    <span className="font-mono text-mono font-semibold text-ink">{token.name}</span>
                    <span className="font-mono text-micro text-ink-3 normal-case tracking-normal">
                      {theme === "light" ? token.light : token.dark}
                    </span>
                    <span className="text-micro leading-snug text-ink-2 normal-case tracking-normal">{token.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorSection() {
  return (
    <Section
      id="color"
      index="01 / Colour"
      title={<Emph text="Warm paper, deep ink, *one* teal." />}
      intro="Colour is semantic. Teal means action. Sage and gold add calm emphasis. Terracotta is a rare accent and never carries text. Status colours always travel with an icon or a word."
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <Palette theme="light" />
        <Palette theme="dark" />
      </div>
    </Section>
  );
}

export function TypeSection() {
  return (
    <Section
      id="type"
      index="02 / Type"
      title={<Emph text="Fraunces to *speak*, Atkinson to read." />}
      intro="Fraunces (variable, optical size) sets display and headings, light at large sizes. Atkinson Hyperlegible Next carries everything people read or operate. One italic word per headline is the signature move."
    >
      <ol className="m-0 grid list-none gap-0 p-0">
        {TYPE_SCALE.map((row) => (
          <li
            key={row.token}
            className="grid items-baseline gap-2 border-b border-line py-5 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10"
          >
            <span className="grid gap-0.5">
              <span className="font-mono text-mono font-semibold text-ink">{row.token}</span>
              <span className="text-micro text-ink-3 normal-case tracking-normal">{row.family}</span>
            </span>
            <span
              className={cn(
                row.token,
                row.display ? "font-display font-light text-balance display-soft" : "font-sans",
                row.token === "text-h4" && "font-bold",
                row.token === "text-micro" && "font-semibold uppercase",
                row.token === "text-mono" && "font-mono",
                row.token === "text-small" && "text-ink-2",
              )}
            >
              <Emph text={row.sample} />
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function ShapeSection() {
  return (
    <Section
      id="space"
      index="03 / Space, shape, depth"
      title={<Emph text="Rhythm, not *uniform* padding." />}
      intro="A 4px base with deliberate jumps; named steps for page rhythm (gutter, stack, section). Radii are soft but not uniform. Shadows are warm, layered and low-opacity ink."
    >
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <SubHead>Space · Tailwind steps (×4px)</SubHead>
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {SPACE.map((step) => (
              <li key={step} className="flex items-center gap-4">
                <span className="w-14 font-mono text-mono text-ink-2">{step}</span>
                <span aria-hidden className="h-3 rounded-[2px] bg-sage" style={{ width: `${step * 4}px` }} />
                <span className="font-mono text-micro text-ink-3 normal-case tracking-normal">{step * 4}px</span>
              </li>
            ))}
            <li className="mt-3 grid gap-1 text-small text-ink-2">
              <span>
                <code className="font-mono text-mono text-ink">gutter</code> clamp(1rem → 2.5rem) ·{" "}
                <code className="font-mono text-mono text-ink">stack</code> clamp(1.5rem → 3rem) ·{" "}
                <code className="font-mono text-mono text-ink">section</code> clamp(4rem → 9rem)
              </span>
            </li>
          </ul>
        </div>
        <div className="grid gap-10">
          <div>
            <SubHead>Radii</SubHead>
            <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-4">
              {RADII.map((r) => (
                <li key={r.token} className="grid content-start gap-2">
                  <span aria-hidden className={cn("block h-16 border border-line-strong bg-card shadow-xs", r.token)} />
                  <span className="font-mono text-mono font-semibold">{r.token}</span>
                  <span className="text-micro text-ink-3 normal-case tracking-normal">
                    {r.value} · {r.use}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <SubHead>Elevation</SubHead>
            <ul className="m-0 grid list-none grid-cols-2 gap-5 rounded-lg bg-paper-2 p-5 sm:grid-cols-3">
              {SHADOWS.map((s) => (
                <li key={s.token} className={cn("grid gap-1 rounded-md bg-card p-4", s.token)}>
                  <span className="font-mono text-mono font-semibold">{s.token}</span>
                  <span className="text-micro text-ink-3 normal-case tracking-normal">{s.use}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function MotionSection() {
  return (
    <Section
      id="motion"
      index="04 / Motion"
      title={<Emph text="Motion that *explains*, then gets out of the way." />}
      intro="One curve, ease-out-expo cubic-bezier(0.16, 1, 0.3, 1), four durations. Hover a row to see each. With reduced motion on, everything here is instant; motion/react springs live in lib/ui/motion.ts."
    >
      <ul className="m-0 grid list-none gap-3 p-0">
        {DURATIONS.map((d) => (
          <li
            key={d.token}
            tabIndex={0}
            className="group/motion grid cursor-default items-center gap-3 rounded-md border border-line bg-card p-4 focus-ring sm:grid-cols-[12rem_minmax(0,1fr)_14rem]"
          >
            <span className="font-mono text-mono font-semibold">
              {d.token} <span className="text-ink-3">· {d.ms}ms</span>
            </span>
            <span className="relative block h-2 rounded-pill bg-paper-2 shadow-inset">
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-[calc(100%-1rem)] transition-transform ease-out-expo",
                  "group-hover/motion:translate-x-full group-focus-visible/motion:translate-x-full motion-reduce:transition-none",
                  d.token,
                )}
              >
                <span className="absolute left-0 top-1/2 block size-4 -translate-y-1/2 rounded-pill bg-teal shadow-sm" />
              </span>
            </span>
            <span className="text-small text-ink-2">{d.use}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-8 grid gap-4 text-small sm:grid-cols-4">
        {[
          ["gentle", "170 / 26", "Cards, layout"],
          ["soft", "120 / 22", "Sheets, sections"],
          ["snappy", "420 / 34", "Toggles, chips"],
          ["lively", "260 / 18", "A step completed"],
        ].map(([name, cfg, use]) => (
          <div key={name} className="grid gap-1 rounded-md bg-paper-2 p-4">
            <dt className="font-mono text-mono font-semibold text-ink">SPRING.{name}</dt>
            <dd className="m-0 text-ink-2">
              stiffness/damping {cfg} · {use}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
