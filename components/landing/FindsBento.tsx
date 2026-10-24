import { FlaskConical, HandCoins, HeartHandshake, MapPin } from "lucide-react";
import { SourceChip } from "@/components/ui/source-chip";
import { cn } from "@/lib/ui/cn";
import { FIND_SOURCES } from "./content";

function Eyebrow({ icon: Icon, children }: { icon: typeof MapPin; children: string }) {
  return (
    <p className="m-0 flex items-center gap-2 text-micro font-semibold uppercase text-ink-2">
      <Icon aria-hidden className="size-4 text-teal" strokeWidth={2} />
      {children}
    </p>
  );
}

/** Converging route lines toward a single point: the centers tile's illustration. */
function RouteArt({ className }: { className?: string }) {
  const starts = [
    [10, 40],
    [0, 150],
    [30, 250],
    [120, 270],
    [230, 270],
    [300, 210],
    [310, 90],
  ] as const;
  return (
    <svg viewBox="0 0 320 280" aria-hidden className={cn("pointer-events-none", className)}>
      <g className="fill-none stroke-ink/20" strokeWidth={1} strokeDasharray="3 5">
        {starts.map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M${x} ${y}Q${(x + 200) / 2 + 30} ${(y + 110) / 2 - 30} 200 110`} />
        ))}
      </g>
      {starts.map(([x, y]) => (
        <circle key={`d${x}-${y}`} cx={x} cy={y} r={3} className="fill-line-strong" />
      ))}
      <circle cx={200} cy={110} r={26} className="fill-gold/30" />
      <circle cx={200} cy={110} r={8} className="fill-teal" />
    </svg>
  );
}

const tile =
  "relative overflow-hidden rounded-lg border p-6 sm:p-8 transition-[transform,box-shadow,border-color] duration-500 ease-out-expo hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** Section 4: the four kinds of resource, as an editorial bento with distinct scales and surfaces. */
export function FindsBento() {
  return (
    <section aria-labelledby="finds-heading" className="page-container py-section">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">What we find</p>
          <h2
            id="finds-heading"
            data-reveal="split"
            className="m-0 mt-4 font-display text-h1 font-light text-balance text-ink display-soft"
          >
            Four kinds of help, each with its <em className="emph">source</em>.
          </h2>
        </div>
        <p className="m-0 max-w-[26rem] text-body text-ink-2 lg:col-span-4 lg:col-start-9">
          Agents read public registries and the organizations&apos; own pages. What they cannot trace back to a page,
          they leave out.
        </p>
      </div>

      <ul className="m-0 mt-stack grid list-none grid-cols-[minmax(0,1fr)] gap-4 p-0 md:grid-cols-6 lg:mt-14 lg:auto-rows-[minmax(15rem,auto)]">
        <li data-reveal="tile" className={cn(tile, "border-line bg-card shadow-md md:col-span-6 lg:col-span-4 lg:row-span-2")}>
          <RouteArt className="absolute -right-6 bottom-0 w-[70%] max-w-[26rem] opacity-90 sm:-right-2" />
          <div className="relative grid h-full max-w-[24rem] content-start gap-4">
            <Eyebrow icon={MapPin}>Specialists &amp; centers</Eyebrow>
            <h3 className="m-0 font-display text-h2 font-light text-ink display-soft">
              Clinicians and centers that see adults with your condition.
            </h3>
            <p className="m-0 text-body text-ink-2">
              With the public intake door for each: a referral line, a new-patient form, a navigator. Never a personal
              inbox.
            </p>
            <ul aria-label="Sources searched" className="m-0 mt-auto flex list-none flex-wrap gap-2 p-0 pt-4 sm:pt-16">
              {FIND_SOURCES.centers.map((domain) => (
                <li key={domain}>
                  <SourceChip url={domain} verified />
                </li>
              ))}
            </ul>
          </div>
        </li>

        <li data-reveal="tile" className={cn(tile, "border-teal/20 bg-teal-soft md:col-span-3 lg:col-span-2")}>
          <div className="grid h-full content-between gap-6">
            <Eyebrow icon={FlaskConical}>Recruiting trials</Eyebrow>
            <div className="grid gap-3">
              <h3 className="m-0 font-display text-h3 text-ink display-soft">Studies enrolling now, with U.S. sites.</h3>
              <SourceChip url={FIND_SOURCES.trials[0]} verified />
            </div>
          </div>
        </li>

        <li data-reveal="tile" className={cn(tile, "border-sage/50 bg-sage-soft md:col-span-3 lg:col-span-2")}>
          <div className="grid h-full content-between gap-6">
            <Eyebrow icon={HeartHandshake}>Advocacy groups</Eyebrow>
            <h3 className="m-0 font-display text-h3 text-ink display-soft">
              People who have walked this road, and organize for it.
            </h3>
          </div>
        </li>

        <li
          data-reveal="tile"
          className={cn(
            tile,
            "grid gap-6 border-gold/50 bg-gold-soft md:col-span-6 md:grid-cols-[1fr_auto] md:items-center lg:col-span-6",
          )}
        >
          <div className="grid gap-3">
            <Eyebrow icon={HandCoins}>Financial &amp; travel aid</Eyebrow>
            <h3 className="m-0 max-w-[36rem] font-display text-h2 font-light text-ink display-soft">
              Help with the cost of getting there: travel, lodging and assistance programs.
            </h3>
          </div>
          <p className="m-0 max-w-[20rem] border-l border-gold pl-5 text-small text-ink-2">
            Found on each program&apos;s own pages, with a link to the page that says who qualifies.
          </p>
        </li>
      </ul>
    </section>
  );
}
