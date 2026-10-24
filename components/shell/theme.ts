"use client";

import { useSyncExternalStore } from "react";

/**
 * Theme preference store. "light" (the default) and "dark" set data-theme on <html>;
 * "system" follows prefers-color-scheme. Persisted in localStorage (a per-viewer convenience;
 * everything renders correctly without it). The pre-paint script in
 * app/layout.tsx applies the stored value before first paint.
 */
export type ThemePreference = "system" | "light" | "dark";

import { THEME_STORAGE_KEY } from "./theme-script";

export { THEME_STORAGE_KEY };
const THEME_EVENT = "wf-theme-change";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStored(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(value) ? value : "light";
  } catch {
    return "light";
  }
}

export function setThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }
  try {
    if (preference === "light") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked (private mode): the attribute still applies for this visit.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** Current preference ("light" on the server). */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readStored, () => "light");
}

/** The theme actually showing ("light" on the server). */
export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () => {
      const forced = document.documentElement.getAttribute("data-theme");
      if (forced === "light" || forced === "dark") return forced;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    () => "light",
  );
}
