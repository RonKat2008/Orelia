import type { ComponentProps } from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/ui/cn";

/** Shared control surface: inputs, textareas and select triggers look like one family. */
export const controlClasses = [
  "w-full rounded-md border border-line-strong bg-card px-3.5 text-body text-ink shadow-xs",
  "placeholder:text-ink-3 transition-[border-color,box-shadow,background-color] duration-150 ease-out-expo",
  "hover:border-ink-3",
  "focus-visible:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  "disabled:cursor-not-allowed disabled:bg-paper-2 disabled:text-ink-3 disabled:hover:border-line-strong",
  "aria-invalid:border-danger aria-invalid:bg-danger-soft/40 aria-invalid:focus-visible:outline-danger",
  "motion-reduce:transition-none",
].join(" ");

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(controlClasses, "h-11", className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlClasses, "min-h-28 resize-y py-3 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-1.5 text-small font-semibold text-ink select-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps extends ComponentProps<"div"> {
  /** Field label text. */
  label: string;
  /** id of the control, wires up the label and messages. */
  htmlFor: string;
  /** Helper text under the label. */
  hint?: string;
  /** Error message; mark the control aria-invalid too. */
  error?: string;
  /** Adds a quiet "(optional)" after the label. */
  optional?: boolean;
}

/**
 * Field: label + hint + control + error with the ids wired.
 * Pass aria-describedby={`${htmlFor}-hint ${htmlFor}-error`} on the control when used.
 */
export function Field({ label, htmlFor, hint, error, optional, className, children, ...props }: FieldProps) {
  return (
    <div data-slot="field" className={cn("grid gap-2", className)} {...props}>
      <div className="grid gap-0.5">
        <Label htmlFor={htmlFor}>
          {label}
          {optional ? <span className="font-normal text-ink-3">(optional)</span> : null}
        </Label>
        {hint ? (
          <p id={`${htmlFor}-hint`} className="m-0 text-small text-ink-2">
            {hint}
          </p>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="m-0 text-small font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
