"use client";

import type { ComponentProps, ReactNode } from "react";
import { CircleAlert, Info } from "lucide-react";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/ui/cn";

export interface TextFieldProps extends Omit<ComponentProps<"input">, "id" | "onChange" | "value"> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
  fieldClassName?: string;
}

/** Label + input + hint + inline error, with aria wiring. */
export function TextField({ id, label, value, onValueChange, hint, error, optional, fieldClassName, className, ...rest }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} optional={optional} className={fieldClassName}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={className}
        {...rest}
      />
    </Field>
  );
}

/** Inline callout. `alert` announces immediately; `status` is polite. */
export function Callout({
  tone = "info",
  role,
  children,
  className,
}: {
  tone?: "info" | "danger" | "warn";
  role?: "alert" | "status";
  children: ReactNode;
  className?: string;
}) {
  const Icon = tone === "info" ? Info : CircleAlert;
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-small",
        tone === "info" && "border-teal/25 bg-teal-soft text-ink",
        tone === "warn" && "border-warn/35 bg-warn-soft text-warn-ink",
        tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-pretty">{children}</div>
    </div>
  );
}

export const EYEBROW = "m-0 text-micro font-semibold uppercase text-ink-3";
export const SECTION_TITLE = "m-0 font-display text-h3 font-normal text-ink display-soft text-balance";
