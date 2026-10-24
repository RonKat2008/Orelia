import { Skeleton } from "@/components/ui/feedback";
import { LoadingState } from "@/components/ui/states";
import { SiteHeader } from "./SiteHeader";

/**
 * Route-level loading state for the dynamic, server-rendered segments (cases, demo, dev, review, share). Each of
 * those segments' loading.tsx re-exports it. The header stays put and the skeleton (an h1 placeholder, a line of
 * copy and one block) sits inside <main>, shaped like the page that is coming; after 3 s it says "Still loading…".
 *
 * Deliberately NOT at app/loading.tsx: a root loading boundary wraps every page in Suspense, and React outlines a
 * large completed boundary (> 12.8 KB of HTML) behind its fallback, so static pages such as the landing page first
 * painted this skeleton and only showed their real content a frame (or a long task) later, which pushed the hero's
 * LCP back.
 */
export function RouteLoading() {
  return (
    <div className="ds-root min-h-dvh bg-paper">
      <SiteHeader cta={null} />
      <main id="main" className="page-container pb-section pt-10 sm:pt-14">
        <LoadingState label="Loading this page" className="max-w-patient">
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </LoadingState>
      </main>
    </div>
  );
}
