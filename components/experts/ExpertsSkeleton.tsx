import { Skeleton } from "@/components/ui";

export function ExpertsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="grid gap-6">
      <span className="sr-only">Loading the research-to-care chains</span>
      {[0, 1].map((key) => (
        <div key={key} className="grid gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="grid gap-3 rounded-lg border border-line bg-card p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
