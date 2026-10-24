import { BadgeCheck, EyeOff, ShieldCheck, Siren, Stethoscope } from "lucide-react";
import { PROMISES } from "../content";

const ICONS = [Stethoscope, BadgeCheck, EyeOff, ShieldCheck, Siren] as const;

/** The PROMISES as a numbered, editorial list. The last (urgent) one gets the gold treatment. */
export function TrustPagePromises() {
  return (
    <ol className="m-0 list-none p-0">
      {PROMISES.map((promise, i) => {
        const Icon = ICONS[i] ?? BadgeCheck;
        const isUrgent = i === PROMISES.length - 1;
        return (
          <li
            key={promise.title}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 border-t border-line py-7 last:border-b sm:grid-cols-[4rem_auto_minmax(0,1fr)] sm:gap-x-6"
          >
            <span aria-hidden className="hidden font-display text-h2 font-light leading-none text-ink-3 display-soft sm:block">
              0{i + 1}
            </span>
            <span
              aria-hidden
              className={
                isUrgent
                  ? "grid size-11 place-items-center rounded-md border border-gold/50 bg-gold-soft text-ink"
                  : "grid size-11 place-items-center rounded-md border border-line-strong bg-card text-teal"
              }
            >
              <Icon className="size-5" strokeWidth={1.75} />
            </span>
            <div className="grid min-w-0 gap-1.5">
              <h3 className="m-0 font-sans text-h4 font-bold text-ink">{promise.title}</h3>
              <p className="m-0 max-w-[36rem] text-body text-ink-2">{promise.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
