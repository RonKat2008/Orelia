"use client";

import type { ComponentProps } from "react";
import { Plus } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export function Accordion({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Root>) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("border-t border-line", className)}
      {...props}
    />
  );
}

export function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b border-line", className)} {...props} />;
}

export function AccordionTrigger({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/acc flex min-h-14 flex-1 cursor-pointer items-center justify-between gap-4 py-4 text-left",
          "font-display text-h4 font-normal text-ink display-soft transition-colors duration-150 hover:text-teal focus-ring",
          className,
        )}
        {...props}
      >
        {children}
        <span
          aria-hidden
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-pill border border-line-strong text-ink-2",
            "transition-[transform,background-color,color,border-color] duration-300 ease-out-expo",
            "group-hover/acc:border-teal group-hover/acc:text-teal",
            "group-data-[state=open]/acc:rotate-45 group-data-[state=open]/acc:border-teal group-data-[state=open]/acc:bg-teal group-data-[state=open]/acc:text-on-teal",
            "motion-reduce:transition-none",
          )}
        >
          <Plus className="size-4" strokeWidth={2.25} />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down motion-reduce:animate-none"
      {...props}
    >
      <div className={cn("max-w-prose pb-5 pr-12 text-body text-ink-2", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
