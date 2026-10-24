import { cn } from "@/lib/ui/cn";
import { HOW_STEPS } from "../content";
import { VIGNETTES } from "../Vignettes";

/** Editorial alternating layout: copy on one side, the matching vignette on the other. */
export function HowPageSteps() {
  return (
    <section aria-labelledby="steps-heading" className="border-y border-line bg-paper-2">
      <div className="page-container py-section">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">What happens, in order</p>
        <h2 id="steps-heading" className="m-0 mt-4 max-w-3xl font-display text-h1 font-light text-balance display-soft">
          Five steps, and you hold the <em className="emph">pen</em>.
        </h2>

        <ol className="m-0 mt-stack list-none p-0">
          {HOW_STEPS.map((step, i) => {
            const Vignette = VIGNETTES[step.id];
            const isFlipped = i % 2 === 1;
            return (
              <li
                key={step.id}
                className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 border-t border-line py-12 first:border-t-0 lg:grid-cols-12 lg:gap-x-16 lg:py-16"
              >
                <div className={cn("grid min-w-0 gap-4 lg:col-span-5", isFlipped && "lg:order-2 lg:col-start-8")}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="grid size-10 place-items-center rounded-pill border border-teal bg-teal font-display text-body text-on-teal shadow-xs"
                    >
                      {i + 1}
                    </span>
                    <p className="m-0 text-micro font-semibold uppercase text-teal">{step.kicker}</p>
                  </div>
                  <h3 className="m-0 font-display text-h2 font-light text-balance text-ink display-soft">{step.title}</h3>
                  <p className="m-0 max-w-[32rem] text-body text-ink-2">{step.body}</p>
                </div>
                <div
                  aria-hidden
                  className={cn("min-w-0 lg:col-span-7", isFlipped && "lg:order-1 lg:col-start-1 lg:row-start-1")}
                >
                  {Vignette ? <Vignette /> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
