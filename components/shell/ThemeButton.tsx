"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { setThemePreference, useResolvedTheme } from "./theme";

/** One-tap light/dark switch for the header, so dark mode is reachable without opening a menu. */
export function ThemeButton({ className }: { className?: string }) {
  const theme = useResolvedTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={next === "dark" ? "Switch to dark mode" : "Switch to light mode"}
      title={next === "dark" ? "Dark mode" : "Light mode"}
      className={cn(
        "inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-pill border border-line bg-card text-ink-2",
        "transition-[border-color,color] duration-150 hover:border-line-strong hover:text-ink focus-ring",
        className,
      )}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}
