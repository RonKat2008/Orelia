import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { START_HREF } from "./content";

/** Section 5: the closing band, carrying the pitch line. */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="page-container pb-4 pt-section">
      <div className="grain relative overflow-hidden rounded-lg border border-line bg-card px-6 py-16 shadow-xl sm:px-12 lg:px-20 lg:py-24">
        <svg
          aria-hidden
          viewBox="0 0 600 400"
          preserveAspectRatio="xMaxYMid slice"
          className="pointer-events-none absolute inset-y-0 right-0 h-full w-full max-w-[44rem] opacity-80"
        >
          <g className="fill-none stroke-teal/15" strokeWidth={1}>
            {Array.from({ length: 9 }, (_, i) => (
              <ellipse key={i} cx={470} cy={200} rx={30 + i * 34} ry={22 + i * 27} transform={`rotate(${-12 + i * 2} 470 200)`} />
            ))}
          </g>
          <circle cx={470} cy={200} r={22} className="fill-gold/40" />
          <circle cx={470} cy={200} r={7} className="fill-gold" />
        </svg>

        <div className="relative max-w-[42rem]">
          <p className="m-0 font-display text-h3 font-light text-ink-2 display-soft">
            Tell your story once.
          </p>
          <h2
            id="cta-heading"
            data-reveal="split"
            className="m-0 mt-2 font-display text-display font-light text-balance text-ink display-soft"
          >
            We knock on every <em className="emph">door</em>.
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Button asChild size="lg" className="group/cta">
              <Link href={START_HREF}>
                Start your case
                <ArrowRight
                  aria-hidden
                  className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </Button>
            <p className="m-0 text-small text-ink-2">Nothing is sent until you approve it.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
