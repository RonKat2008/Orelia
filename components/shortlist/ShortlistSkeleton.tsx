import { LoadingState, Skeleton } from "@/components/ui";

/** Shaped like the final page: a filter row, then list rows beside a detail pane (rows only on phones). */
export function ShortlistSkeleton() {
  return (
    <LoadingState label="Loading the shortlist">
      <div className="grid gap-6 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="grid gap-3">
          <Skeleton className="h-10 w-full rounded-pill" />
          {[0, 1, 2, 3, 4].map((key) => (
            <div key={key} className="grid gap-2 border-b border-line py-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-96 w-full rounded-lg lg:block" />
      </div>
    </LoadingState>
  );
}
