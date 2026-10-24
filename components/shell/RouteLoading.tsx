import { WaypointArt } from "@/components/pitch/StateScreen";
import { Skeleton } from "@/components/ui/feedback";

/**
 * Route-level loading state for the dynamic, server-rendered segments (cases, demo,
 * dev, review, share). Each of those segments' loading.tsx re-exports it.
 *
 * Deliberately NOT at app/loading.tsx: a root loading boundary wraps every page in
 * Suspense, and React outlines a large completed boundary (> 12.8 KB of HTML) behind
 * its fallback, so static pages such as the landing page first painted this skeleton
 * and only showed their real content a frame (or a long task) later, which pushed
 * the hero's LCP back.
 */
export function RouteLoading() {
  return (
    <div className="ds-root min-h-dvh bg-paper">
      <div role="status" aria-busy="true" className="page-container grid gap-8 py-16 sm:py-24">
        <span className="sr-only">Loading</span>
        <WaypointArt variant="waiting" />
        <div className="grid max-w-prose gap-4">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      </div>
    </div>
  );
}
