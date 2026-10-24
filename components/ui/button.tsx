import type { ComponentProps, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/ui/cn";

/**
 * Button. Primary is the one teal action per view; secondary sits on paper;
 * ghost is for toolbars; link is inline; danger is for destructive, confirmed acts.
 * States: hover lifts 1px and deepens; active presses down; focus-visible draws
 * the ring; loading keeps the width and announces aria-busy.
 */
export const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 select-none items-center justify-center gap-2",
    "whitespace-nowrap font-sans font-semibold tracking-[0.005em] cursor-pointer",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo",
    "focus-ring active:translate-y-px active:duration-75",
    "disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none disabled:translate-y-0",
    "aria-busy:cursor-progress motion-reduce:transition-none motion-reduce:active:translate-y-0",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-teal text-on-teal shadow-sm",
          "shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--elev-sm)]",
          "hover:bg-teal-ink hover:-translate-y-px hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--elev-md)]",
          "active:shadow-inset",
        ],
        secondary: [
          "bg-card text-ink border border-line-strong shadow-xs",
          "hover:border-ink-3 hover:bg-paper-2 hover:-translate-y-px hover:shadow-sm",
          "active:bg-paper-2 active:shadow-inset",
        ],
        ghost: ["bg-transparent text-ink", "hover:bg-paper-2", "active:bg-line/60"],
        link: [
          "h-auto! px-0! text-teal underline decoration-teal/35 decoration-1 underline-offset-[0.22em]",
          "hover:text-teal-ink hover:decoration-teal-ink active:translate-y-0",
        ],
        danger: [
          "bg-danger text-paper shadow-sm",
          "hover:-translate-y-px hover:shadow-md hover:bg-[color-mix(in_oklab,var(--danger)_86%,var(--ink))]",
          "active:shadow-inset",
        ],
      },
      size: {
        sm: "h-9 rounded-sm px-3 text-small [&_svg]:size-4",
        md: "h-11 rounded-md px-5 text-body [&_svg]:size-[1.1em]",
        lg: "h-13 rounded-md px-7 text-lead [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (e.g. next/link) with button styling. */
    asChild?: boolean;
    /** Shows a spinner, disables the button and sets aria-busy. */
    loading?: boolean;
    /** Accessible text while loading, e.g. "Sending". Defaults to the children. */
    loadingText?: ReactNode;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

const iconButtonVariants = cva("px-0!", {
  variants: {
    size: {
      sm: "size-9",
      md: "size-11",
      lg: "size-13",
    },
  },
  defaultVariants: { size: "md" },
});

export type IconButtonProps = Omit<ButtonProps, "size" | "loadingText"> &
  VariantProps<typeof iconButtonVariants> & {
    /** Required: icon-only controls must have an accessible name. */
    label: string;
  };

/** Square, icon-only button. Defaults to the ghost variant. */
export function IconButton({ label, size, variant = "ghost", className, children, ...props }: IconButtonProps) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn(iconButtonVariants({ size }), className)}
      {...props}
    >
      {children}
    </Button>
  );
}
