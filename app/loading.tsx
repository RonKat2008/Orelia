import { WaypointArt } from "@/components/pitch/StateScreen";
import { Skeleton } from "@/components/ui/feedback";

export default function Loading() {
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
