import { HOW_IT_WORKS_ID, HOW_STEPS } from "./content";
import { VIGNETTES } from "./Vignettes";

/**
 * Section 2: the five-scene story (details, swarm, validation, plan, outreach). On wide screens the vignette stage is sticky
 * and LandingChoreography flips `data-active` as each step crosses the middle of the
 * viewport. On phones (and without JS) each step shows its own vignette inline.
 */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="relative border-y border-line bg-paper-2">
      <div className="page-container py-section">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3 lg:col-span-12">How it works</p>
          <h2
            id={HOW_IT_WORKS_ID}
            tabIndex={-1}
            data-reveal="split"
            className="m-0 scroll-mt-24 font-display text-h1 font-light text-balance text-ink outline-none display-soft lg:col-span-8"
          >
            From your details to a door that <em className="emph">opens</em>.
          </h2>
        </div>

        <div className="mt-stack grid grid-cols-[minmax(0,1fr)] gap-x-12 lg:mt-16 lg:grid-cols-12">
          <ol className="relative m-0 list-none p-0 lg:col-span-5">
            {/* Progress rail (desktop): scaled by scroll progress. */}
            <span aria-hidden className="absolute bottom-0 left-[1.15rem] top-0 hidden w-px bg-line-strong lg:block" />
            <span
              aria-hidden
              data-rail
              className="absolute left-[1.15rem] top-0 hidden h-full w-px origin-top scale-y-0 bg-teal lg:block motion-reduce:scale-y-100"
            />
            {HOW_STEPS.map((step, i) => {
              const Vignette = VIGNETTES[step.id];
              return (
                <li
                  key={step.id}
                  data-step={i}
                  data-active={i === 0}
                  className="group/step group/scene relative grid grid-cols-[minmax(0,1fr)] gap-5 border-t border-line py-10 first:border-t-0 lg:min-h-[68vh] lg:content-center lg:border-t-0 lg:py-0 lg:pl-16"
                >
                  <span
                    aria-hidden
                    className="grid size-9 place-items-center rounded-pill border border-line-strong bg-card font-display text-small text-ink-2 shadow-xs transition-[background-color,color,border-color,transform] duration-500 ease-out-expo group-data-[active=true]/step:scale-110 group-data-[active=true]/step:border-teal group-data-[active=true]/step:bg-teal group-data-[active=true]/step:text-on-teal motion-reduce:transition-none lg:absolute lg:left-0 lg:top-1/2 lg:-translate-y-1/2 lg:group-data-[active=true]/step:-translate-y-1/2"
                  >
                    {i + 1}
                  </span>
                  <div className="grid gap-3 transition-transform duration-700 ease-out-expo lg:group-data-[active=true]/step:translate-x-1 motion-reduce:transition-none">
                    <p className="m-0 text-micro font-semibold uppercase text-teal">{step.kicker}</p>
                    <h3 className="m-0 font-display text-h3 text-ink display-soft transition-colors duration-500 lg:text-ink-3 lg:group-data-[active=true]/step:text-ink">
                      {step.title}
                    </h3>
                    <p className="m-0 max-w-[30rem] text-body text-ink-2 transition-colors duration-500 lg:text-ink-3 lg:group-data-[active=true]/step:text-ink-2">
                      {step.body}
                    </p>
                  </div>
                  <div className="lg:hidden">{Vignette ? <Vignette /> : null}</div>
                </li>
              );
            })}
          </ol>

          <div aria-hidden className="hidden lg:col-span-7 lg:block">
            <div className="sticky top-[calc(50vh-16.5rem)] h-[33rem]">
              <div aria-hidden className="absolute inset-6 rotate-[-1.5deg] rounded-lg border border-line bg-paper shadow-md" />
              {HOW_STEPS.map((step, i) => {
                const Vignette = VIGNETTES[step.id];
                return (
                  <div
                    key={step.id}
                    data-step-frame={i}
                    data-active={i === 0}
                    className="group/scene absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 opacity-0 transition-[opacity,transform] duration-700 ease-out-expo data-[active=false]:translate-y-[calc(-50%+1.5rem)] data-[active=true]:opacity-100 motion-reduce:transition-none"
                  >
                    {Vignette ? <Vignette /> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
