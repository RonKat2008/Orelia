import Link from "next/link";
import { ArrowRight, BadgeCheck, EyeOff, ShieldCheck, Siren, Stethoscope } from "lucide-react";
import { PROMISES } from "./content";

const ICONS = [Stethoscope, BadgeCheck, EyeOff, ShieldCheck, Siren] as const;

/**
 * "What we never do": the safety guardrails, as a designed list. The band is always Night Paper
 * (data-theme="dark"), so in the light theme it reads as a deliberate change of key.
 */
export function TrustSection() {
  return (
    <section data-theme="dark" aria-labelledby="trust-heading" className="grain bg-paper-2 text-ink">
      <div className="page-container grid grid-cols-[minmax(0,1fr)] gap-stack py-section lg:grid-cols-12 lg:gap-x-12">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-28">
            <p className="m-0 text-micro font-semibold uppercase text-ink-3">What we never do</p>
            <h2
              id="trust-heading"
              data-reveal="split"
              className="m-0 mt-4 font-display text-h1 font-light text-balance text-ink display-soft"
            >
              Some lines we <em className="emph">never</em> cross.
            </h2>
            <p className="m-0 mt-6 max-w-[28rem] text-lead text-pretty text-ink-2">
              These limits are built into how Wayfinder works, checked in code before anything leaves. You cannot switch them off, and neither can we.
            </p>
            <Link
              href="/trust"
              className="group/trust mt-8 inline-flex items-center gap-2 rounded-sm text-body font-semibold text-teal no-underline underline-offset-4 hover:text-teal-ink hover:underline focus-ring"
            >
              Read the full trust and safety page
              <ArrowRight
                aria-hidden
                className="size-4 transition-transform duration-300 ease-out-expo group-hover/trust:translate-x-1 motion-reduce:transition-none"
              />
            </Link>
          </div>
        </div>

        <ol className="m-0 list-none p-0 lg:col-span-7">
          {PROMISES.map((promise, i) => {
            const Icon = ICONS[i] ?? BadgeCheck;
            const isUrgent = i === PROMISES.length - 1;
            return (
              <li
                key={promise.title}
                data-reveal="rise"
                className="group/promise grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t border-line py-7 last:border-b sm:grid-cols-[4rem_auto_1fr] sm:gap-x-6"
              >
                <span
                  aria-hidden
                  className="hidden font-display text-h2 font-light leading-none text-ink-3 display-soft sm:block"
                >
                  0{i + 1}
                </span>
                <span
                  aria-hidden
                  className={
                    isUrgent
                      ? "grid size-11 place-items-center rounded-md border border-gold/50 bg-gold-soft text-gold"
                      : "grid size-11 place-items-center rounded-md border border-line-strong bg-card text-teal transition-colors duration-300 group-hover/promise:border-teal/60"
                  }
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <div className="grid gap-1.5">
                  <h3 className="m-0 font-sans text-h4 font-bold text-ink">{promise.title}</h3>
                  <p className="m-0 max-w-[34rem] text-body text-ink-2">{promise.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
