"use client";

import type { ReactNode } from "react";
import type { ViewMode } from "@/lib/view-mode/view-mode";
import { useHydrated } from "./useHydrated";
import { useViewMode } from "./view-store";

/**
 * The view to render for. Hydration-safe: the server render and the first client render both use `serverView`
 * (patient unless the page read ?view= on the server), then the viewer's stored or URL choice takes over.
 */
export function useActiveView(serverView: ViewMode = "patient"): ViewMode {
  const hydrated = useHydrated();
  const view = useViewMode(serverView);
  return hydrated ? view : serverView;
}

/** True when the judge view is active (false on the server and during hydration unless serverView is "judge"). */
export function useIsJudgeView(serverView: ViewMode = "patient"): boolean {
  return useActiveView(serverView) === "judge";
}

interface ViewOnlyProps {
  children: ReactNode;
  /** What the server rendered, when the page read ?view=. Default patient. */
  serverView?: ViewMode;
  /** Rendered in the other view instead of nothing. */
  fallback?: ReactNode;
}

/** Render children only in judge view. Agent names, scores, sources and traces go here (docs/DESIGN-v2.md 5.2). */
export function JudgeOnly({ children, serverView, fallback = null }: ViewOnlyProps) {
  return <>{useActiveView(serverView) === "judge" ? children : fallback}</>;
}

/** Render children only in patient view (the default, including on the server). */
export function PatientOnly({ children, serverView, fallback = null }: ViewOnlyProps) {
  return <>{useActiveView(serverView) === "patient" ? children : fallback}</>;
}
