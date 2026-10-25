import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HERO_PROMISE, HERO_REASSURANCE, HOW_IT_WORKS_ID, START_HREF } from "./content";
import { FieldPoster } from "./field/FieldPoster";
import { HeroField } from "./field/HeroField";
import { HeroMotionProvider, HeroPauseButton } from "./HeroMotion";
import { ScrollToLink } from "./ScrollToLink";

/**
 * The landing hero: one centred column of copy over the field's convergence point. The h1,
 * tagline and CTAs are server-rendered (the LCP element is the h1); the field poster paints
 * with the HTML and the WebGL field fades in when idle.
 */
export function Hero() {
  return (
    <HeroMotionProvider>
      <section
        data-hero
        aria-labelledby="hero-heading"
        className="group/hero grain relative overflow-hidden border-b border-line"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
        >
          <FieldPoster />
          <HeroField />
        </div>
        {/* Legibility wash behind the headline column, in the page's own paper colour. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_50%_58%,var(--paper)_30%,transparent_78%)] opacity-60"
        />

        <div className="page-container relative flex flex-col items-center pb-24 pt-28 text-center sm:pt-32 lg:min-h-[min(56rem,calc(100svh-6.5rem))] lg:justify-center lg:pb-24 lg:pt-36">
          <p className="m-0 flex items-center gap-2.5 text-small font-semibold text-ink-2">
            <span aria-hidden className="h-px w-8 bg-terracotta" />
            For adults with a rare disease
            <span aria-hidden className="h-px w-8 bg-terracotta" />
          </p>
          {/* Width in em, not ch: ch follows the active font, so the line breaks would change
              when the serif swaps in over its fallback (a layout shift). */}
          <h1
            id="hero-heading"
            className="m-0 mt-6 max-w-[9.5em] font-display text-display font-light text-balance text-ink display-soft"
          >
            Find the experts. Get <em className="emph">seen</em>.
          </h1>
          <p className="m-0 mt-8 max-w-[34rem] font-display text-h3 font-light text-pretty text-ink display-soft">
            {HERO_PROMISE}
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <Button asChild size="lg" className="group/cta">
              <Link href={START_HREF}>
                Start your case
                <ArrowRight
                  aria-hidden
                  className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </Button>
            <Button asChild variant="link" className="py-3">
              <ScrollToLink targetId={HOW_IT_WORKS_ID}>
                See how it works
                <ArrowDown aria-hidden />
              </ScrollToLink>
            </Button>
          </div>

          <p className="m-0 mt-5 text-small text-ink-2">{HERO_REASSURANCE}</p>
        </div>

        <div className="page-container relative -mt-14 flex justify-end pb-5">
          <HeroPauseButton />
        </div>
      </section>
    </HeroMotionProvider>
  );
}
