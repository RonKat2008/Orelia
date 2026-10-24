"use client";

import type { ComponentProps } from "react";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

const tick = "transition-[background-color,border-color,box-shadow] duration-150 ease-out-expo motion-reduce:transition-none";

/** Checkbox (supports checked="indeterminate"). 24px box inside a 44px-friendly row. */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm border-[1.5px] border-ink-3 bg-card shadow-xs",
        tick,
        "hover:border-teal focus-ring",
        "data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[state=checked]:text-on-teal",
        "data-[state=indeterminate]:border-teal data-[state=indeterminate]:bg-teal data-[state=indeterminate]:text-on-teal",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center data-[state=checked]:animate-in data-[state=checked]:zoom-in-75 motion-reduce:animate-none">
        {props.checked === "indeterminate" ? (
          <Minus aria-hidden className="size-4" strokeWidth={3} />
        ) : (
          <Check aria-hidden className="size-4" strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Switch: for settings that take effect immediately. Use Checkbox inside forms. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-[28px] w-[48px] shrink-0 cursor-pointer items-center rounded-pill border border-line-strong bg-paper-2 p-[2px] shadow-inset",
        tick,
        "hover:border-ink-3 focus-ring",
        "data-[state=checked]:border-teal data-[state=checked]:bg-teal",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[22px] rounded-pill bg-card shadow-sm ring-1 ring-line",
          "transition-transform duration-300 ease-out-expo data-[state=checked]:translate-x-[20px] data-[state=checked]:ring-transparent",
          "motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root data-slot="radio-group" className={cn("grid gap-3", className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioPrimitive.Item>) {
  return (
    <RadioPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer grid size-6 shrink-0 cursor-pointer place-items-center rounded-pill border-[1.5px] border-ink-3 bg-card shadow-xs",
        tick,
        "hover:border-teal focus-ring data-[state=checked]:border-teal",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator className="block size-3 rounded-pill bg-teal data-[state=checked]:animate-in data-[state=checked]:zoom-in-50 motion-reduce:animate-none" />
    </RadioPrimitive.Item>
  );
}

export interface ChoiceCardProps extends ComponentProps<"label"> {
  title: string;
  description?: string;
}

/**
 * A full-row label around a Checkbox/RadioGroupItem: the whole card is the hit
 * target and lights up when its control is checked.
 */
export function ChoiceRow({ title, description, className, children, ...props }: ChoiceCardProps) {
  return (
    <label
      data-slot="choice-row"
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line bg-card p-4",
        "transition-[border-color,background-color,box-shadow] duration-150 hover:border-line-strong",
        "has-[[data-state=checked]]:border-teal/60 has-[[data-state=checked]]:bg-teal-soft/50 has-[[data-state=checked]]:shadow-sm",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className,
      )}
      {...props}
    >
      <span className="pt-0.5">{children}</span>
      <span className="grid gap-0.5">
        <span className="font-semibold text-ink">{title}</span>
        {description ? <span className="text-small text-ink-2">{description}</span> : null}
      </span>
    </label>
  );
}
