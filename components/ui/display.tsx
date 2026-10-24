import type { ComponentProps, ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { getInitials, hashToBucket } from "@/lib/ui/format";

/* ------------------------------ EmptyState ------------------------------ */

export interface EmptyStateProps extends Omit<ComponentProps<"div">, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually one Button. */
  action?: ReactNode;
}

/** EmptyState: say what will appear here and the one thing to do next. */
export function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "grain flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-paper-2/60 px-6 py-12 text-center sm:py-16",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden
          className="mb-5 grid size-14 place-items-center rounded-pill bg-card text-teal shadow-sm ring-1 ring-line [&_svg]:size-6"
        >
          {icon}
        </div>
      ) : null}
      <h3 data-slot="empty-state-title" className="font-display text-h3 font-normal text-ink display-soft text-balance">
        {title}
      </h3>
      {description ? <p className="m-0 mt-2 max-w-[46ch] text-body text-ink-2 text-pretty">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/* -------------------------------- Stepper ------------------------------- */

export interface StepperStep {
  id: string;
  label: string;
  description?: string;
}

export interface StepperProps extends Omit<ComponentProps<"ol">, "children"> {
  steps: StepperStep[];
  /** Index of the current step. Steps before it are complete. */
  current: number;
  orientation?: "horizontal" | "vertical";
  /** Optional: render each label as a link (e.g. next/link) for completed steps. */
  renderLabel?: (step: StepperStep, state: StepState) => ReactNode;
}

export type StepState = "complete" | "current" | "upcoming";

/**
 * Stepper: the patient journey as a route of waypoints. State is shown by the
 * marker shape (check / filled ring / hollow), the word in the sr-only text and
 * aria-current, not by colour alone.
 */
export function Stepper({ steps, current, orientation = "horizontal", renderLabel, className, ...props }: StepperProps) {
  const vertical = orientation === "vertical";
  return (
    <ol
      data-slot="stepper"
      data-orientation={orientation}
      className={cn(
        "m-0 list-none p-0",
        vertical ? "grid gap-0" : "grid auto-cols-fr grid-flow-col gap-2 max-sm:grid-flow-row max-sm:gap-0",
        className,
      )}
      {...props}
    >
      {steps.map((step, index) => {
        const state: StepState = index < current ? "complete" : index === current ? "current" : "upcoming";
        const isLast = index === steps.length - 1;
        return (
          <li
            key={step.id}
            aria-current={state === "current" ? "step" : undefined}
            data-state={state}
            className={cn(
              "group/step relative flex gap-3",
              vertical ? "pb-7 last:pb-0" : "sm:flex-col sm:gap-3 max-sm:pb-6 max-sm:last:pb-0",
            )}
          >
            {/* connector */}
            {!isLast ? (
              <span
                aria-hidden
                className={cn(
                  "absolute rounded-pill",
                  state === "complete" ? "bg-teal" : "bg-line-strong",
                  vertical
                    ? "left-[15px] top-9 bottom-1 w-0.5"
                    : "max-sm:left-[15px] max-sm:top-9 max-sm:bottom-1 max-sm:w-0.5 sm:left-11 sm:right-1 sm:top-[15px] sm:h-0.5",
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative z-10 grid size-8 shrink-0 place-items-center rounded-pill border-2 font-semibold text-small transition-colors duration-300",
                state === "complete" && "border-teal bg-teal text-on-teal",
                state === "current" && "border-teal bg-card text-teal shadow-[0_0_0_5px_var(--teal-soft)]",
                state === "upcoming" && "border-line-strong bg-card text-ink-3",
              )}
            >
              {state === "complete" ? <Check className="size-4" strokeWidth={3} /> : index + 1}
            </span>
            <span className="grid gap-0.5 pt-1 sm:pt-0">
              <span
                className={cn(
                  "font-semibold leading-snug",
                  state === "upcoming" ? "text-ink-2" : "text-ink",
                  state === "current" && "text-teal-ink dark:text-teal",
                )}
              >
                {renderLabel ? renderLabel(step, state) : step.label}
                <span className="sr-only">
                  {" "}
                  ({state === "complete" ? "done" : state === "current" ? "current step" : "not started"})
                </span>
              </span>
              {step.description ? <span className="m-0 text-small text-ink-2">{step.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------- Stat --------------------------------- */

export interface StatProps extends ComponentProps<"div"> {
  label: string;
  value: ReactNode;
  /** Short context line, e.g. "within 50 miles". */
  hint?: ReactNode;
  /** Optional trailing element: a Badge or icon. */
  adornment?: ReactNode;
}

/** Stat: one number that matters, set in the serif with a quiet label. */
export function Stat({ label, value, hint, adornment, className, ...props }: StatProps) {
  return (
    <div data-slot="stat" className={cn("grid gap-1", className)} {...props}>
      <dt className="text-micro font-semibold uppercase text-ink-3">{label}</dt>
      <dd className="m-0 flex items-baseline gap-3">
        <span className="font-display text-h1 font-light tabular-nums leading-none tracking-tight text-ink display-soft">
          {value}
        </span>
        {adornment}
      </dd>
      {hint ? <dd className="m-0 text-small text-ink-2">{hint}</dd> : null}
    </div>
  );
}

/** Wrap Stats in a StatGroup so the dt/dd pairs sit in a <dl>. */
export function StatGroup({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      data-slot="stat-group"
      className={cn("m-0 grid grid-cols-2 gap-x-8 gap-y-6 sm:flex sm:flex-wrap sm:gap-x-12", className)}
      {...props}
    />
  );
}

/* ---------------------------- AvatarInitials ---------------------------- */

const AVATAR_TONES = [
  "bg-sage-soft text-ink ring-sage/50",
  "bg-indigo-soft text-ink ring-indigo/30",
  "bg-teal-soft text-teal-ink ring-teal/20 dark:text-teal",
  "bg-rose-soft text-ink ring-rose/30",
];

export interface AvatarInitialsProps extends ComponentProps<"span"> {
  name: string;
  size?: "sm" | "md" | "lg";
}

/** AvatarInitials: people and organisations, with a stable tone per name. */
export function AvatarInitials({ name, size = "md", className, ...props }: AvatarInitialsProps) {
  const tone = AVATAR_TONES[hashToBucket(name, AVATAR_TONES.length)];
  return (
    <span
      data-slot="avatar"
      role="img"
      aria-label={name}
      className={cn(
        "inline-grid shrink-0 select-none place-items-center rounded-pill font-display font-medium ring-1 ring-inset",
        size === "sm" && "size-8 text-micro",
        size === "md" && "size-11 text-body",
        size === "lg" && "size-16 text-h4",
        tone,
        className,
      )}
      {...props}
    >
      <span aria-hidden>{getInitials(name)}</span>
    </span>
  );
}
