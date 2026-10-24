import { Skeleton } from "@/components/ui";

export function ShortlistSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid gap-8"
    >
      <span className="sr-only">Loading the shortlist</span>
      <Skeleton className="h-24 w-full rounded-lg" />
      {[0, 1].map((key) => (
        <div
          key={key}
          className="grid gap-4 rounded-lg border border-line bg-card p-6"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}
