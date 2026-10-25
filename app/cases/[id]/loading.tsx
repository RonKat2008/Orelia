import { Skeleton } from "@/components/ui/feedback";
import { LoadingState } from "@/components/ui/states";

/**
 * Stage switch fallback, rendered INSIDE the case layout (header, stage bar and <main> stay put; this is content
 * only). Next prefetches it with the shared layout, so a click on another stage swaps to this skeleton at once while
 * the dynamic page streams. Shaped like a stage page: title, lede, one block.
 */
export default function CaseStageLoading() {
  return (
    <LoadingState label="Loading this step">
      <Skeleton className="h-10 w-2/3 max-w-xl" />
      <Skeleton className="h-5 w-full max-w-2xl" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </LoadingState>
  );
}
