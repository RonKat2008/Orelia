import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HERO_REASSURANCE, NO_DIAGNOSIS_LINE, START_HREF } from "./content";

/** Landing section 4: one line and the primary button. */
export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="page-container py-section">
      <h2 id="cta-heading" className="m-0 font-display text-h2 font-light text-balance text-ink display-soft">
        Ready when you are.
      </h2>
      <p className="m-0 mt-4 max-w-prose text-body text-pretty text-ink-2">{NO_DIAGNOSIS_LINE}</p>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Button asChild size="lg" className="group/cta">
          <Link href={START_HREF}>
            Start your case
            <ArrowRight
              aria-hidden
              className="transition-transform duration-300 ease-out-expo group-hover/cta:translate-x-0.5 motion-reduce:transition-none"
            />
          </Link>
        </Button>
        <p className="m-0 text-small text-ink-2">{HERO_REASSURANCE}</p>
      </div>
    </section>
  );
}
