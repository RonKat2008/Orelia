import { LoadingState, Skeleton } from "@/components/ui";

export function ExpertsSkeleton() {
  return (
    <LoadingState label="Loading the experts we found">
      <div className="grid border-t border-line">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="grid gap-2 border-b border-line px-3 py-4">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </LoadingState>
  );
}
