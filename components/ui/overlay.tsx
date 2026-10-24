"use client";

import type { ComponentProps } from "react";
import { Popover as PopoverPrimitive, Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

const floatIn = [
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97]",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]",
  "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
  "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
  "motion-reduce:animate-none",
].join(" ");

/* ------------------------------- Tooltip -------------------------------- */

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Tooltip: supplementary labels only (never the only place information lives;
 * touch users cannot hover). Each Tooltip carries its own provider so it works
 * anywhere; Providers also mounts one with the app's delay.
 */
export function Tooltip({ delayDuration = 250, ...props }: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipPrimitive.Provider>
  );
}

export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-64 rounded-sm bg-ink px-3 py-1.5 text-small text-paper shadow-md text-balance",
          floatIn,
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-ink" width={10} height={5} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/* ------------------------------- Popover -------------------------------- */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = "start",
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-card p-4 text-ink shadow-lg outline-none",
          floatIn,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
