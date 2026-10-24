import { ClipboardList, ListChecks, Search, Send, type LucideIcon } from "lucide-react";
import { HOW_IT_WORKS_ID, HOW_LEDE, HOW_STEPS } from "./content";

const STEP_ICONS: Record<string, LucideIcon> = {
  tell: ClipboardList,
  search: Search,
  choose: ListChecks,
  reach: Send,
};

/**
 * Landing section 2: the four steps, in one row of plain text. The same four names as the patient
 * progress line inside a case, so there is one step count site-wide.
 */
export function HowItWorks() {
  return (
    <section aria-labelledby={HOW_IT_WORKS_ID} className="border-b border-line">
      <div className="page-container py-section">
        <h2
          id={HOW_IT_WORKS_ID}
          tabIndex={-1}
          className="m-0 scroll-mt-24 font-display text-h2 font-light text-balance text-ink outline-none display-soft"
        >
          How it works
        </h2>
        <p className="m-0 mt-4 max-w-prose text-body text-pretty text-ink-2">{HOW_LEDE}</p>
        <ol className="m-0 mt-12 grid list-none grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 p-0 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
          {HOW_STEPS.map((step, i) => {
            const Icon = STEP_ICONS[step.id] ?? ClipboardList;
            return (
              <li key={step.id} className="grid min-w-0 content-start gap-3">
                <Icon aria-hidden className="size-6 text-teal" strokeWidth={1.75} />
                <h3 className="m-0 font-display text-h3 font-light text-ink display-soft">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="m-0 max-w-[22rem] text-body text-pretty text-ink-2">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
