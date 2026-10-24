import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LANDING_PROMISES } from "./content";

/** Landing section 3: three promises, in plain words, with a link to the full trust page. */
export function NeverSection() {
  return (
    <section aria-labelledby="never-heading" className="border-b border-line bg-paper-2">
      <div className="page-container py-section">
        <h2 id="never-heading" className="m-0 font-display text-h2 font-light text-balance text-ink display-soft">
          What we never do
        </h2>
        <ul className="m-0 mt-12 grid list-none grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-8 p-0 md:grid-cols-3 lg:mt-16">
          {LANDING_PROMISES.map((promise) => (
            <li key={promise.id} className="grid min-w-0 content-start gap-3 border-t border-line-strong pt-6">
              <h3 className="m-0 font-display text-h3 font-light text-ink display-soft">{promise.title}</h3>
              <p className="m-0 max-w-[22rem] text-body text-pretty text-ink-2">{promise.body}</p>
            </li>
          ))}
        </ul>
        <Link
          href="/trust"
          className="group/trust mt-10 inline-flex min-h-11 items-center gap-2 rounded-sm text-body font-semibold text-teal underline decoration-teal/35 underline-offset-4 hover:text-teal-ink focus-ring"
        >
          Read how we keep these promises
          <ArrowRight
            aria-hidden
            className="size-4 transition-transform duration-300 ease-out-expo group-hover/trust:translate-x-1 motion-reduce:transition-none"
          />
        </Link>
      </div>
    </section>
  );
}
