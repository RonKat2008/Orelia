import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/ui/cn";

/**
 * Surface hierarchy (bottom to top):
 *   inset  - sunk into the page: form groups, quoted evidence, code
 *   flat   - card colour + hairline: most content
 *   raised - lifted with a warm layered shadow: the thing to look at first
 * `interactive` adds a designed hover/press for clickable cards (wrap a Link with asChild).
 */
export const surfaceVariants = cva("relative block text-ink", {
  variants: {
    variant: {
      flat: "bg-card border border-line",
      raised: "bg-card border border-line/70 shadow-md",
      inset: "bg-paper-2 shadow-inset",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-5 sm:p-6",
      lg: "p-6 sm:p-9",
    },
    radius: {
      md: "rounded-md",
      lg: "rounded-lg",
    },
    interactive: {
      true: [
        "cursor-pointer focus-ring transition-[transform,box-shadow,border-color] duration-300 ease-out-expo",
        "hover:-translate-y-0.5 hover:shadow-lg hover:border-line-strong active:translate-y-0 active:shadow-sm",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      ],
      false: "",
    },
  },
  defaultVariants: { variant: "flat", padding: "md", radius: "lg", interactive: false },
});

export type SurfaceProps = ComponentProps<"div"> &
  VariantProps<typeof surfaceVariants> & { asChild?: boolean };

export function Surface({ className, variant, padding, radius, interactive, asChild, ...props }: SurfaceProps) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="surface"
      data-variant={variant ?? "flat"}
      className={cn(surfaceVariants({ variant, padding, radius, interactive }), className)}
      {...props}
    />
  );
}

/** Card is a Surface with a header/body/footer rhythm. */
export const Card = Surface;

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />;
}

export function CardEyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="card-eyebrow"
      className={cn("m-0 text-micro font-semibold uppercase text-ink-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn("m-0 max-w-none font-display text-h3 font-normal text-ink display-soft", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("m-0 text-body text-ink-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4", className)}
      {...props}
    />
  );
}
