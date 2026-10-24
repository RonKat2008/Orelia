"use client";

import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-5", className)} {...props} />;
}

/** variant "underline" (default): editorial, for page sections. "pill": compact segmented control. */
export function TabsList({
  className,
  variant = "underline",
  ...props
}: ComponentProps<typeof TabsPrimitive.List> & { variant?: "underline" | "pill" }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        "group/tabs flex max-w-full items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none]",
        variant === "underline" && "gap-6 shadow-[inset_0_-1px_0_var(--line)]",
        variant === "pill" && "w-fit gap-1 rounded-pill bg-paper-2 p-1 shadow-inset",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap font-semibold text-ink-2",
        "transition-[color,background-color,box-shadow] duration-150 hover:text-ink focus-ring-inset motion-reduce:transition-none",
        "disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
        // underline
        "group-data-[variant=underline]/tabs:px-0.5 group-data-[variant=underline]/tabs:after:absolute",
        "group-data-[variant=underline]/tabs:after:inset-x-0 group-data-[variant=underline]/tabs:after:bottom-0",
        "group-data-[variant=underline]/tabs:after:h-0.5 group-data-[variant=underline]/tabs:after:rounded-pill",
        "group-data-[variant=underline]/tabs:after:origin-left group-data-[variant=underline]/tabs:after:scale-x-0",
        "group-data-[variant=underline]/tabs:after:bg-teal group-data-[variant=underline]/tabs:after:transition-transform",
        "group-data-[variant=underline]/tabs:after:duration-300 group-data-[variant=underline]/tabs:after:ease-out-expo",
        "group-data-[variant=underline]/tabs:data-[state=active]:after:scale-x-100 data-[state=active]:text-ink",
        // pill
        "group-data-[variant=pill]/tabs:min-h-9 group-data-[variant=pill]/tabs:rounded-pill group-data-[variant=pill]/tabs:px-4 group-data-[variant=pill]/tabs:text-small",
        "group-data-[variant=pill]/tabs:data-[state=active]:bg-teal-soft group-data-[variant=pill]/tabs:data-[state=active]:text-teal-ink dark:group-data-[variant=pill]/tabs:data-[state=active]:text-teal",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "focus-ring rounded-sm data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
