"use client";

import type { ComponentProps } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/ui/cn";

/** BackLink look for in-page steps, where "back" is a state change and not a URL. */
export function BackButton({
  children,
  className,
  ...props
}: ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="back-link"
      className={cn(
        "inline-flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-sm bg-transparent p-0 text-small font-semibold text-teal",
        "hover:text-teal-ink hover:underline underline-offset-4 focus-ring",
        className,
      )}
      {...props}
    >
      <ChevronLeft aria-hidden className="size-4" />
      {children}
    </button>
  );
}
