import { Suspense } from "react";
import { ShortlistSkeleton } from "@/components/shortlist/ShortlistSkeleton";
import { ShortlistView } from "@/components/shortlist/ShortlistView";

/** Content only: the case layout supplies the header, stage bar and <main>. ShortlistView renders its own CasePage. */
export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<ShortlistSkeleton />}>
      <ShortlistView caseId={id} />
    </Suspense>
  );
}
