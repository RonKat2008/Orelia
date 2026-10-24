import { useId, type ComponentProps, type ReactNode } from "react";
import { Progress as ProgressPrimitive, Separator as SeparatorPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";
import { toPercent } from "@/lib/ui/format";

/* ------------------------------- Progress ------------------------------- */

export interface ProgressProps extends Omit<ComponentProps<typeof ProgressPrimitive.Root>, "value" | "max"> {
  value: number;
  max?: number;
  /** Visible label above the bar; also the accessible name (via aria-labelledby). */
  label?: ReactNode;
  /** Accessible name when there is no visible label. One of `label` or `aria-label` is needed (axe aria-progressbar-name). */
  "aria-label"?: string;
  /** Text at the right of the label, e.g. "3 of 5 sources checked". */
  valueText?: string;
  tone?: "teal" | "ok" | "warn";
}

export function Progress({ value, max = 100, label, valueText, tone = "teal", className, "aria-label": ariaLabel, ...props }: ProgressProps) {
  const percent = toPercent(value, max);
  const labelId = useId();
  const named = ariaLabel ? { "aria-label": ariaLabel } : label ? { "aria-labelledby": labelId } : { "aria-label": valueText ?? "Progress" };
  const bar = { teal: "bg-teal", ok: "bg-ok", warn: "bg-warn" }[tone];
  return (
    <div data-slot="progress" className={cn("grid gap-2", className)}>
      {label || valueText ? (
        <div className="flex items-baseline justify-between gap-4 text-small">
          {label ? (
            <span id={labelId} className="font-semibold text-ink">
              {label}
            </span>
          ) : (
            <span />
          )}
          {valueText ? <span className="tabular-nums text-ink-2">{valueText}</span> : null}
        </div>
      ) : null}
      <ProgressPrimitive.Root
        value={value}
        max={max}
        aria-valuetext={valueText}
        {...named}
        className="relative h-2 overflow-hidden rounded-pill bg-paper-2 shadow-inset"
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn("h-full w-full rounded-pill transition-transform duration-400 ease-out-expo motion-reduce:transition-none", bar)}
          style={{ transform: `translateX(-${100 - percent}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
}

/* ------------------------------- Skeleton ------------------------------- */

/** Loading placeholder. Mark the loading region aria-busy; skeletons are aria-hidden. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "rounded-sm bg-paper-2 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--card)_70%,transparent),transparent)] bg-size-[200%_100%] animate-shimmer",
        "motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------- Separator ------------------------------ */

export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-line",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px self-stretch",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------- Kbd --------------------------------- */

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-line-strong border-b-2 bg-card px-1.5",
        "font-mono text-micro font-semibold text-ink-2 tracking-normal",
        className,
      )}
      {...props}
    />
  );
}
