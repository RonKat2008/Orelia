"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { setThemePreference, useThemePreference, type ThemePreference } from "./theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "system", label: "Match device", Icon: Monitor },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** Three-way theme control (light / device / dark) as a radio group. */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = useThemePreference();
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("inline-flex items-center gap-0.5 rounded-pill border border-line bg-paper-2 p-0.5 shadow-inset", className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            data-slot="theme-option"
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setThemePreference(value)}
            className={cn(
              "grid size-8 cursor-pointer place-items-center rounded-pill text-ink-2 transition-[background-color,color,box-shadow] duration-150",
              "hover:text-ink focus-ring motion-reduce:transition-none",
              active && "bg-card text-ink shadow-sm",
            )}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
