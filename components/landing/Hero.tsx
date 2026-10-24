import Link from "next/link";
import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentRunIsland } from "./AgentRunIsland";
import { AgentRunPanelView } from "./AgentRunPanelView";
import { HERO_PROMISE, HOW_IT_WORKS_ID, JUDGE_START_HREF, START_HREF, TRUST_LINE } from "./content";
import { FieldPoster } from "./field/FieldPoster";
import { HeroField } from "./field/HeroField";
import { HeroMotionProvider, HeroPauseButton } from "./HeroMotion";
import { ScrollToLink } from "./ScrollToLink";
import { RUN_KEYFRAMES, frameAt } from "./run-script";

/** The run's first frame, server-rendered so the panel paints before any JS. */
const FIRST_FRAME = frameAt(RUN_KEYFRAMES[0] ?? 0);

/**
 * The landing hero. The h1, lede and CTAs are server-rendered (the LCP element is the
 * h1); the field poster paints with the HTML and the WebGL field fades in when idle.
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
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_18%_42%,var(--paper)_25%,transparent_75%)] opacity-90"
        />

        <div className="page-container relative grid grid-cols-[minmax(0,1fr)] items-center gap-x-10 gap-y-14 pb-24 pt-12 sm:pt-16 lg:min-h-[min(56rem,calc(100svh-6.5rem))] lg:grid-cols-12 lg:pb-20 lg:pt-12">
          <div className="lg:col-span-6 xl:col-span-6">
            <p className="m-0 flex items-center gap-2.5 text-micro font-semibold uppercase text-ink-2">
              <span aria-hidden className="h-px w-8 bg-terracotta" />
              For adults with a rare disease
            </p>
            {/* Width in em, not ch: ch follows the active font, so the line breaks would change
                when the serif swaps in over its fallback (a layout shift). 6.8em = the serif's 12ch. */}
            <h1
              id="hero-heading"
              className="m-0 mt-5 max-w-[6.8em] font-display text-display font-light text-balance text-ink display-soft"
            >
              Find the experts. Get <em className="emph">seen</em>.
            </h1>
            <p className="m-0 mt-6 max-w-[30rem] font-display text-h3 font-light text-pretty text-ink display-soft">
              {HERO_PROMISE}
            </p>
            <p className="m-0 mt-4 max-w-[34rem] text-body text-pretty text-ink-2">
              Give your details once. Research agents find the specialists, trials, advocates and aid that fit, check
              every claim against its source, then call, email or apply online for you, only after you approve, and
              follow up until someone answers.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="group/cta">
                <Link href={START_HREF}>
                  Start your case
                  <ArrowRight
                    aria-hidden
                    className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
                  />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <ScrollToLink targetId={HOW_IT_WORKS_ID}>
                  See how it works
                  <ArrowDown aria-hidden />
                </ScrollToLink>
              </Button>
            </div>

            <p className="m-0 mt-5 text-small text-ink-2">
              <Link
                href={JUDGE_START_HREF}
                className="font-semibold text-teal underline decoration-teal/40 underline-offset-4 hover:text-teal-ink focus-ring rounded-sm"
              >
                Judge view: watch the agents work
              </Link>
            </p>

            <ul
              aria-label="Our promises"
              className="m-0 mt-7 flex max-w-[36rem] list-none flex-wrap gap-x-4 gap-y-2 p-0 text-small text-ink-2"
            >
              {TRUST_LINE.map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check aria-hidden className="size-3.5 shrink-0 text-teal" strokeWidth={2.5} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-center lg:col-span-6 lg:justify-end xl:col-span-5 xl:col-start-8">
            <AgentRunIsland>
              <AgentRunPanelView frame={FIRST_FRAME} />
            </AgentRunIsland>
          </div>
        </div>

        <div className="page-container relative -mt-14 flex justify-end pb-5">
          <HeroPauseButton />
        </div>
      </section>
    </HeroMotionProvider>
  );
}
